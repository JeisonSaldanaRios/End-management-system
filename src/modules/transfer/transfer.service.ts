import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { assertEntityExists } from '../../common/validation/assert-exists';
import { CampEntity } from '../camp/camp.entity';
import { InventoryMovementService } from '../inventoryMovement/inventoryMovement.service';
import { IntercampRequestEntity } from '../intercampRequest/intercampRequest.entity';
import { NotificationService } from '../notification/notification.service';

import { TransferRepository } from './transfer.repository';
import type {
  CreateTransferDTO,
  Transfer,
  TransferStatus,
  UpdateTransferDTO,
  UpdateTransferTransportStaffDTO,
} from './transfer.model';

@Injectable()
export class TransferService {
  constructor(
    private readonly repository: TransferRepository,
    private readonly notificationService: NotificationService,
    private readonly inventoryMovementService: InventoryMovementService,
    private readonly dataSource: DataSource,
  ) {}

  private roundToTwo(value: number): string {
    return (Math.round(value * 100) / 100).toFixed(2);
  }

  private toNumber(value: string | number | null | undefined): number {
    const parsed = Number.parseFloat(String(value ?? '0'));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private getTripDurationDays(plannedDepartureDate: Date, plannedArrivalDate: Date): number {
    const millisPerDay = 24 * 60 * 60 * 1000;
    const rawDays = (plannedArrivalDate.getTime() - plannedDepartureDate.getTime()) / millisPerDay;
    const roundedDays = Math.ceil(rawDays);
    return Math.max(1, Number.isFinite(roundedDays) ? roundedDays : 1);
  }

  async syncTransferRations(transferId: number): Promise<Transfer | null> {
    const transfer = await this.repository.findById(transferId);
    if (!transfer) {
      return null;
    }

    const scope = await this.resolveRequestScope(transfer.requestId);
    const supplierCampId = scope.destinationCampId;
    const camp = await this.dataSource.getRepository(CampEntity).findOne({
      where: { id: supplierCampId },
      select: { id: true, minimumDailyRationPerPerson: true },
    });

    if (!camp) {
      throw new Error('Campamento de origen no encontrado para calcular raciones');
    }

    const plannedDepartureDate = transfer.plannedDepartureDate;
    const plannedArrivalDate = transfer.plannedArrivalDate;
    if (!plannedDepartureDate || !plannedArrivalDate) {
      const updated = await this.repository.update(transferId, { rationsForTrip: '0.00' });
      return updated;
    }

    const peopleCount = await this.repository.countTransferPeople(transferId);
    if (peopleCount === 0) {
      const updated = await this.repository.update(transferId, { rationsForTrip: '0.00' });
      return updated;
    }

    const rationPerPerson = Number.parseFloat(camp.minimumDailyRationPerPerson);
    if (!Number.isFinite(rationPerPerson) || rationPerPerson <= 0) {
      throw new Error('La racion minima diaria del campamento es invalida');
    }

    const durationDays = this.getTripDurationDays(plannedDepartureDate, plannedArrivalDate);
    const totalRations = this.roundToTwo(peopleCount * rationPerPerson * durationDays);

    return await this.repository.update(transferId, { rationsForTrip: totalRations });
  }

  async createRequestedPersonManifestFromRequest(
    transferId: number,
    requestId: number,
    supplierCampId: number,
  ): Promise<number> {
    const assignedCount = await this.repository.createRequestedPersonManifestFromRequest(
      transferId,
      requestId,
      supplierCampId,
    );
    await this.syncTransferRations(transferId);
    return assignedCount;
  }

  private async assertTransferCanMove(transfer: Transfer): Promise<void> {
    const transportStaffCount = await this.repository.countTransferTransportStaff(transfer.id);
    if (transportStaffCount <= 0) {
      throw new BadRequestException('El traslado debe tener personal operativo asignado');
    }
  }

  private async assertRationsAvailable(transfer: Transfer): Promise<void> {
    await this.syncTransferRations(transfer.id);
    const refreshed = await this.repository.findById(transfer.id);
    const rationsForTrip = this.toNumber(refreshed?.rationsForTrip ?? transfer.rationsForTrip);

    if (rationsForTrip <= 0) {
      throw new BadRequestException('El traslado debe tener raciones calculadas mayores a 0');
    }

    const scope = await this.resolveRequestScope(transfer.requestId);
    const supplierCampId = scope.destinationCampId;
    const rationInventory = await this.repository.findRationInventoryCandidate(supplierCampId);

    if (!rationInventory) {
      throw new BadRequestException('No hay recurso FOOD configurado para raciones del traslado');
    }

    const currentAmount = this.toNumber(rationInventory.currentAmount);
    const minimumAmount = this.toNumber(rationInventory.minimumAlertAmount);
    const remainingAmount = currentAmount - rationsForTrip;

    if (currentAmount < rationsForTrip) {
      throw new BadRequestException('Inventario insuficiente de raciones para ejecutar el traslado');
    }

    if (remainingAmount < minimumAmount) {
      throw new BadRequestException(
        'El traslado dejaria las raciones por debajo del minimo permitido',
      );
    }
  }

  private async applyTransferRations(transfer: Transfer, actorUserId: number): Promise<void> {
    const alreadyApplied = await this.repository.countAppliedTransferRationMovements(transfer.id);
    if (alreadyApplied > 0) {
      return;
    }

    const refreshed = await this.repository.findById(transfer.id);
    const rationsForTrip = this.toNumber(refreshed?.rationsForTrip ?? transfer.rationsForTrip);
    if (rationsForTrip <= 0) {
      throw new BadRequestException('El traslado debe tener raciones calculadas mayores a 0');
    }

    const scope = await this.resolveRequestScope(transfer.requestId);
    const supplierCampId = scope.destinationCampId;
    const rationInventory = await this.repository.findRationInventoryCandidate(supplierCampId);
    if (!rationInventory) {
      throw new BadRequestException('No hay recurso FOOD configurado para raciones del traslado');
    }

    await this.inventoryMovementService.createMovement({
      campId: supplierCampId,
      resourceTypeId: rationInventory.resourceTypeId,
      amount: this.roundToTwo(rationsForTrip),
      movementType: 'DAILY_RATION',
      sourceId: transfer.id,
      sourceType: 'transfer_rations',
      recordedBy: actorUserId,
      description: `Transfer rations consumed for transfer #${transfer.id}`,
    });
  }

  private async assertInventoryConsumptionPreservesMinimum(
    campId: number,
    resourceTypeId: number,
    amount: string,
  ): Promise<void> {
    const rows = (await this.dataSource.query(
      `SELECT current_amount::text AS current_amount,
              minimum_alert_amount::text AS minimum_alert_amount
       FROM public.camp_inventory
       WHERE camp_id = $1
         AND resource_type_id = $2
       LIMIT 1`,
      [campId, resourceTypeId],
    )) as Array<{ current_amount: string; minimum_alert_amount: string }>;

    const currentAmount = this.toNumber(rows[0]?.current_amount);
    const minimumAmount = this.toNumber(rows[0]?.minimum_alert_amount);
    const consumedAmount = this.toNumber(amount);

    if (currentAmount < consumedAmount) {
      throw new BadRequestException('Inventario insuficiente para ejecutar el traslado');
    }

    if (currentAmount - consumedAmount < minimumAmount) {
      throw new BadRequestException('El traslado dejaria inventario por debajo del minimo');
    }
  }

  private async applyTransferSentInventory(
    transferId: number,
    requestId: number,
    actorUserId: number,
  ): Promise<void> {
    const alreadyApplied = await this.repository.countAppliedTransferSentMovements(transferId);
    if (alreadyApplied > 0) {
      return;
    }

    const scope = await this.resolveRequestScope(requestId);
    const supplierCampId = scope.destinationCampId;
    const deliveredRows = await this.repository.findDeliveredResourcesByTransferId(transferId);

    for (const delivered of deliveredRows) {
      await this.assertInventoryConsumptionPreservesMinimum(
        supplierCampId,
        delivered.resourceTypeId,
        delivered.sentAmount,
      );

      await this.inventoryMovementService.createMovement({
        campId: supplierCampId,
        resourceTypeId: delivered.resourceTypeId,
        amount: delivered.sentAmount,
        movementType: 'TRANSFER_SENT',
        sourceId: transferId,
        sourceType: 'transfer',
        recordedBy: actorUserId,
        description: `Auto transfer sent movement for transfer #${transferId} (detail #${delivered.id})`,
      });
    }
  }

  private async applyTransferReceivedInventory(
    transferId: number,
    requestId: number,
    actorUserId: number,
  ): Promise<void> {
    const alreadyApplied = await this.repository.countAppliedTransferReceivedMovements(transferId);
    if (alreadyApplied > 0) {
      return;
    }

    const scope = await this.resolveRequestScope(requestId);
    const recipientCampId = scope.originCampId;
    const deliveredRows = await this.repository.findDeliveredResourcesByTransferId(transferId);

    for (const delivered of deliveredRows) {
      await this.inventoryMovementService.createMovement({
        campId: recipientCampId,
        resourceTypeId: delivered.resourceTypeId,
        amount: delivered.receivedAmount,
        movementType: 'TRANSFER_RECEIVED',
        sourceId: transferId,
        sourceType: 'transfer',
        recordedBy: actorUserId,
        description: `Auto transfer received movement for transfer #${transferId} (detail #${delivered.id})`,
      });
    }
  }

  private async createTransferHistoryEntry(
    transferId: number,
    previousStatus: TransferStatus,
    newStatus: TransferStatus,
    userId: number,
  ): Promise<void> {
    await this.repository.createTransferHistoryEntry({
      transferId,
      previousStatus,
      newStatus,
      userId,
      comment: `Auto history on transfer status change: ${previousStatus} -> ${newStatus}`,
    });
  }

  private async resolveRequestScope(requestId: number): Promise<{
    originCampId: number;
    destinationCampId: number;
    createdBy: number;
    respondedBy: number | null;
  }> {
    const scope = await this.repository.resolveRequestScope(requestId);
    if (!scope) {
      throw new Error('Solicitud intercampamento no encontrada');
    }

    return scope;
  }

  async createTransfer(data: CreateTransferDTO): Promise<Transfer> {
    await assertEntityExists(
      this.dataSource,
      IntercampRequestEntity,
      data.requestId,
      'Intercamp request',
    );

    const existing = await this.repository.findByRequestId(data.requestId);
    if (existing) {
      throw new Error('Ya existe un traslado para esta solicitud');
    }

    const created = await this.repository.create(data);
    await this.syncTransferRations(created.id);
    const scope = await this.resolveRequestScope(data.requestId);

    const message = `El traslado #${created.id} fue creado con estado ${created.status}.`;
    await this.notificationService.notifyCampRoles(
      scope.originCampId,
      ['SYSTEM_ADMIN', 'RESOURCE_MANAGEMENT', 'TRAVEL_MANAGER'],
      {
        type: 'TRANSFER_PENDING',
        title: 'Nuevo traslado intercampamento',
        message,
        sourceType: 'transfer',
        sourceId: created.id,
      },
    );
    await this.notificationService.notifyCampRoles(
      scope.destinationCampId,
      ['SYSTEM_ADMIN', 'RESOURCE_MANAGEMENT', 'TRAVEL_MANAGER'],
      {
        type: 'TRANSFER_PENDING',
        title: 'Nuevo traslado intercampamento',
        message,
        sourceType: 'transfer',
        sourceId: created.id,
      },
    );

    return created;
  }

  async getTransferById(id: number): Promise<Transfer | null> {
    return await this.repository.findById(id);
  }

  async getTransferByRequestId(requestId: number): Promise<Transfer | null> {
    return await this.repository.findByRequestId(requestId);
  }

  async getAllTransfers(filters?: {
    requestId?: number;
    status?: TransferStatus;
    page?: number;
    limit?: number;
  }): Promise<{ data: Transfer[]; total: number }> {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 10;
    const offset = (page - 1) * limit;

    const repoFilters: {
      requestId?: number;
      status?: TransferStatus;
      offset: number;
      limit: number;
    } = {
      offset,
      limit,
    };

    if (filters?.requestId !== undefined) repoFilters.requestId = filters.requestId;
    if (filters?.status !== undefined) repoFilters.status = filters.status;

    return await this.repository.findAllAndCount(repoFilters);
  }

  async updateTransfer(id: number, data: UpdateTransferDTO): Promise<Transfer | null> {
    const existing = await this.repository.findById(id);
    if (!existing) return null;

    if (existing.status === 'COMPLETED' || existing.status === 'CANCELED') {
      throw new BadRequestException('No se puede modificar un traslado finalizado');
    }

    const updateData: UpdateTransferDTO = { ...data };

    if (updateData.status === 'IN_TRANSIT') {
      await this.assertTransferCanMove(existing);
      await this.assertRationsAvailable(existing);
      updateData.actualDepartureDate = updateData.actualDepartureDate ?? new Date();
    }

    if (updateData.status === 'COMPLETED') {
      await this.assertTransferCanMove(existing);
      if (existing.status === 'PENDING_DEPARTURE') {
        await this.assertRationsAvailable(existing);
      }

      const scope = await this.resolveRequestScope(existing.requestId);
      const resolvedDepartureApprovedBy =
        updateData.departureApprovedBy ??
        existing.departureApprovedBy ??
        scope.respondedBy ??
        scope.createdBy;
      const resolvedArrivalApprovedBy =
        updateData.arrivalApprovedBy ??
        existing.arrivalApprovedBy ??
        scope.respondedBy ??
        scope.createdBy;

      if (resolvedDepartureApprovedBy === null || resolvedArrivalApprovedBy === null) {
        throw new Error('Para completar el traslado se requieren aprobaciones de salida y llegada');
      }

      updateData.departureApprovedBy = resolvedDepartureApprovedBy;
      updateData.arrivalApprovedBy = resolvedArrivalApprovedBy;
      updateData.actualDepartureDate =
        updateData.actualDepartureDate ?? existing.actualDepartureDate ?? new Date();
      updateData.actualArrivalDate = updateData.actualArrivalDate ?? new Date();
    }

    if (updateData.requestId !== undefined && updateData.requestId !== existing.requestId) {
      await assertEntityExists(
        this.dataSource,
        IntercampRequestEntity,
        updateData.requestId,
        'Intercamp request',
      );

      const byRequest = await this.repository.findByRequestId(updateData.requestId);
      if (byRequest && byRequest.id !== id) {
        throw new Error('Ya existe un traslado para esta solicitud');
      }
    }

    const updated = await this.repository.update(id, updateData);
    if (!updated) {
      return null;
    }

    if (updated.status !== existing.status) {
      const scope = await this.resolveRequestScope(updated.requestId);
      const actorUserId =
        updated.arrivalApprovedBy ??
        updated.departureApprovedBy ??
        data.arrivalApprovedBy ??
        data.departureApprovedBy ??
        scope.respondedBy ??
        scope.createdBy;

      if (updated.status === 'IN_TRANSIT') {
        await this.repository.setManifestInTransit(
          updated.id,
          updated.actualDepartureDate ?? new Date(),
        );
        await this.applyTransferRations(updated, actorUserId);
        await this.applyTransferSentInventory(updated.id, updated.requestId, actorUserId);
      }

      if (updated.status === 'COMPLETED') {
        if (existing.status === 'PENDING_DEPARTURE') {
          await this.repository.setManifestInTransit(
            updated.id,
            updated.actualDepartureDate ?? new Date(),
          );
          await this.applyTransferRations(updated, actorUserId);
          await this.applyTransferSentInventory(updated.id, updated.requestId, actorUserId);
        }

        await this.applyTransferReceivedInventory(updated.id, updated.requestId, actorUserId);
        await this.repository.completeManifest(
          updated.id,
          updated.requestId,
          updated.actualArrivalDate ?? new Date(),
        );
      }

      if (updated.status === 'CANCELED') {
        await this.repository.cancelManifest(updated.id);
      }

      await this.createTransferHistoryEntry(
        updated.id,
        existing.status,
        updated.status,
        actorUserId,
      );

      const notificationType =
        updated.status === 'COMPLETED'
          ? 'TRANSFER_COMPLETED'
          : updated.status === 'CANCELED'
            ? 'TRANSFER_CANCELED'
            : 'TRANSFER_PENDING';

      const title =
        updated.status === 'COMPLETED'
          ? 'Traslado completado'
          : updated.status === 'CANCELED'
            ? 'Traslado cancelado'
            : updated.status === 'IN_TRANSIT'
              ? 'Traslado en transito'
              : 'Traslado pendiente de salida';

      const message = `El traslado #${updated.id} cambio su estado a ${updated.status}.`;

      await this.notificationService.notifyCampRoles(
        scope.originCampId,
        ['SYSTEM_ADMIN', 'RESOURCE_MANAGEMENT', 'TRAVEL_MANAGER'],
        {
          type: notificationType,
          title,
          message,
          sourceType: 'transfer',
          sourceId: updated.id,
        },
      );
      await this.notificationService.notifyCampRoles(
        scope.destinationCampId,
        ['SYSTEM_ADMIN', 'RESOURCE_MANAGEMENT', 'TRAVEL_MANAGER'],
        {
          type: notificationType,
          title,
          message,
          sourceType: 'transfer',
          sourceId: updated.id,
        },
      );
    }

    await this.syncTransferRations(updated.id);

    return updated;
  }

  private async assertTransportStaffRationsAvailable(
    transfer: Transfer,
    supplierCampId: number,
    transportStaffCount: number,
  ): Promise<string> {
    const requestedPeopleCount = await this.repository.countTransferRequestedPeople(transfer.id);
    const peopleCount = transportStaffCount + requestedPeopleCount;
    if (peopleCount <= 0) {
      throw new BadRequestException('El traslado debe tener personas asignadas para calcular raciones');
    }

    const camp = await this.dataSource.getRepository(CampEntity).findOne({
      where: { id: supplierCampId },
      select: { id: true, minimumDailyRationPerPerson: true },
    });

    if (!camp) {
      throw new BadRequestException('Campamento proveedor no encontrado para calcular raciones');
    }

    const rationPerPerson = this.toNumber(camp.minimumDailyRationPerPerson);
    if (rationPerPerson <= 0) {
      throw new BadRequestException('La racion minima diaria del campamento es invalida');
    }

    const durationDays = this.getTripDurationDays(
      transfer.plannedDepartureDate,
      transfer.plannedArrivalDate,
    );
    const rationsForTrip = this.roundToTwo(peopleCount * rationPerPerson * durationDays);
    const rationInventory = await this.repository.findRationInventoryCandidate(supplierCampId);

    if (!rationInventory) {
      throw new BadRequestException('No hay recurso FOOD configurado para raciones del traslado');
    }

    const committedRows = (await this.dataSource.query(
      `SELECT COALESCE(SUM(t.rations_for_trip), 0)::text AS total
       FROM public.transfer t
       INNER JOIN public.intercamp_request r ON r.id = t.request_id
       WHERE r.destination_camp_id = $1
         AND r.status = 'APPROVED'
         AND t.status = 'PENDING_DEPARTURE'
         AND t.id <> $2`,
      [supplierCampId, transfer.id],
    )) as Array<{ total: string }>;

    const currentAmount = this.toNumber(rationInventory.currentAmount);
    const minimumAmount = this.toNumber(rationInventory.minimumAlertAmount);
    const committedAmount = this.toNumber(committedRows[0]?.total);
    const requiredAmount = this.toNumber(rationsForTrip);
    const availableAmount = currentAmount - committedAmount;

    if (availableAmount < requiredAmount) {
      throw new BadRequestException('Inventario insuficiente de raciones para reservar el traslado');
    }

    if (currentAmount - committedAmount - requiredAmount < minimumAmount) {
      throw new BadRequestException(
        'El manifiesto dejaria las raciones por debajo del minimo permitido',
      );
    }

    return rationsForTrip;
  }

  async updateTransportStaff(
    id: number,
    data: UpdateTransferTransportStaffDTO,
  ): Promise<Transfer | null> {
    const existing = await this.repository.findById(id);
    if (!existing) return null;

    if (existing.status !== 'PENDING_DEPARTURE') {
      throw new BadRequestException('Solo se puede editar personal operativo antes de la salida');
    }

    if (!Array.isArray(data.transportPersonIds)) {
      throw new BadRequestException('transportPersonIds must be an array');
    }

    const uniquePersonIds = [...new Set(data.transportPersonIds)];
    if (uniquePersonIds.length === 0) {
      throw new BadRequestException('Debe asignar al menos una persona operativa al traslado');
    }

    if (uniquePersonIds.some((personId) => !Number.isInteger(personId) || personId <= 0)) {
      throw new BadRequestException('transportPersonIds must contain positive integers');
    }

    const scope = await this.resolveRequestScope(existing.requestId);
    const supplierCampId = scope.destinationCampId;
    const people = (await this.dataSource.query(
      `SELECT p.id, p.camp_id, p.current_status, o.name AS occupation_name
       FROM public.person p
       LEFT JOIN public.occupation o ON o.id = p.occupation_id
       WHERE p.id = ANY($1::int[])`,
      [uniquePersonIds],
    )) as Array<{
      id: number;
      camp_id: number;
      current_status: string;
      occupation_name: string | null;
    }>;

    if (people.length !== uniquePersonIds.length) {
      throw new BadRequestException('Una o mas personas operativas no existen');
    }

    const invalidPerson = people.find(
      (person) => person.camp_id !== supplierCampId || person.current_status !== 'ACTIVE',
    );
    if (invalidPerson) {
      throw new BadRequestException(
        'Las personas operativas deben estar activas en el campamento proveedor',
      );
    }

    const hasScout = people.some((person) => person.occupation_name?.toLowerCase() === 'scout');
    if (!hasScout) {
      throw new BadRequestException('Debe asignar al menos una persona operativa con oficio Scout');
    }

    const busyRows = (await this.dataSource.query(
      `SELECT DISTINCT assigned.person_id
       FROM (
         SELECT tp.person_id
         FROM public.transfer_person tp
         INNER JOIN public.transfer t ON t.id = tp.transfer_id
         WHERE tp.person_id = ANY($1::int[])
           AND tp.transfer_id <> $2
           AND tp.status <> 'CANCELED'
           AND t.status IN ('PENDING_DEPARTURE', 'IN_TRANSIT')
         UNION
         SELECT trp.person_id
         FROM public.transfer_requested_person trp
         INNER JOIN public.transfer t ON t.id = trp.transfer_id
         WHERE trp.person_id = ANY($1::int[])
           AND trp.transfer_id <> $2
           AND trp.status <> 'CANCELED'
           AND t.status IN ('PENDING_DEPARTURE', 'IN_TRANSIT')
       ) assigned`,
      [uniquePersonIds, id],
    )) as Array<{ person_id: number }>;

    if (busyRows.length > 0) {
      throw new BadRequestException(
        'Una o mas personas operativas ya estan asignadas a otro traslado activo',
      );
    }

    const rationsForTrip = await this.assertTransportStaffRationsAvailable(
      existing,
      supplierCampId,
      uniquePersonIds.length,
    );

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const lockedRows = (await queryRunner.query(
        `SELECT id
         FROM public.transfer
         WHERE id = $1
           AND status = 'PENDING_DEPARTURE'
         FOR UPDATE`,
        [id],
      )) as Array<{ id: number }>;

      if (lockedRows.length === 0) {
        throw new BadRequestException('Solo se puede editar personal operativo antes de la salida');
      }

      await queryRunner.query(
        `UPDATE public.transfer_person
         SET status = 'CANCELED', departure_date = NULL, arrival_date = NULL
         WHERE transfer_id = $1
           AND person_id <> ALL($2::int[])
           AND status <> 'CANCELED'`,
        [id, uniquePersonIds],
      );

      for (const personId of uniquePersonIds) {
        const updatedRows = (await queryRunner.query(
          `UPDATE public.transfer_person
           SET status = 'CONFIRMED', departure_date = NULL, arrival_date = NULL
           WHERE transfer_id = $1
             AND person_id = $2
           RETURNING id`,
          [id, personId],
        )) as Array<{ id: number }>;

        if (updatedRows.length === 0) {
          await queryRunner.query(
            `INSERT INTO public.transfer_person (transfer_id, person_id, status, departure_date, arrival_date)
             VALUES ($1, $2, 'CONFIRMED', NULL, NULL)`,
            [id, personId],
          );
        }
      }

      await queryRunner.query(
        `UPDATE public.transfer
         SET rations_for_trip = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [id, rationsForTrip],
      );

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    const updated = await this.repository.findById(id);
    await this.notificationService.notifyCampRoles(
      scope.originCampId,
      ['SYSTEM_ADMIN', 'RESOURCE_MANAGEMENT', 'TRAVEL_MANAGER'],
      {
        type: 'TRANSFER_PERSON_UPDATED',
        title: 'Manifiesto operativo actualizado',
        message: `El manifiesto operativo del traslado #${id} fue actualizado.`,
        sourceType: 'transfer',
        sourceId: id,
      },
    );
    await this.notificationService.notifyCampRoles(
      scope.destinationCampId,
      ['SYSTEM_ADMIN', 'RESOURCE_MANAGEMENT', 'TRAVEL_MANAGER'],
      {
        type: 'TRANSFER_PERSON_UPDATED',
        title: 'Manifiesto operativo actualizado',
        message: `El manifiesto operativo del traslado #${id} fue actualizado.`,
        sourceType: 'transfer',
        sourceId: id,
      },
    );

    return updated;
  }
  async deleteTransfer(id: number): Promise<boolean> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      return false;
    }

    const scope = await this.resolveRequestScope(existing.requestId);
    const deleted = await this.repository.delete(id);
    if (!deleted) {
      return false;
    }

    const title = 'Traslado eliminado';
    const message = `El traslado #${id} fue eliminado del sistema.`;
    await this.notificationService.notifyCampRoles(
      scope.originCampId,
      ['SYSTEM_ADMIN', 'RESOURCE_MANAGEMENT', 'TRAVEL_MANAGER'],
      {
        type: 'TRANSFER_CANCELED',
        title,
        message,
        sourceType: 'transfer',
        sourceId: id,
      },
    );
    await this.notificationService.notifyCampRoles(
      scope.destinationCampId,
      ['SYSTEM_ADMIN', 'RESOURCE_MANAGEMENT', 'TRAVEL_MANAGER'],
      {
        type: 'TRANSFER_CANCELED',
        title,
        message,
        sourceType: 'transfer',
        sourceId: id,
      },
    );

    return true;
  }

  async assertRequestCampAccess(requestId: number, currentCampId: number): Promise<void> {
    const scope = await this.repository.resolveRequestScope(requestId);
    if (!scope) {
      throw new Error('Solicitud intercampamento no encontrada');
    }

    if (scope.originCampId !== currentCampId && scope.destinationCampId !== currentCampId) {
      throw new BadRequestException('You can only access transfers involving your camp');
    }
  }

  async assertTransferCampAccess(transferId: number, currentCampId: number): Promise<void> {
    const scope = await this.repository.resolveTransferScope(transferId);
    if (!scope) {
      throw new NotFoundException('Transfer not found');
    }

    if (scope.originCampId !== currentCampId && scope.destinationCampId !== currentCampId) {
      throw new BadRequestException('You can only access transfers involving your camp');
    }
  }
}
