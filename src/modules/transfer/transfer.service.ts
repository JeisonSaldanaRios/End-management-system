import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { assertEntityExists } from '../../common/validation/assert-exists';
import { CampEntity } from '../camp/camp.entity';
import { InventoryMovementService } from '../inventoryMovement/inventoryMovement.service';
import { IntercampRequestEntity } from '../intercampRequest/intercampRequest.entity';
import { NotificationService } from '../notification/notification.service';
import { SystemTimeService } from '../systemTime/systemTime.service';

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
  private readonly logger = new Logger(TransferService.name);

  constructor(
    private readonly repository: TransferRepository,
    private readonly notificationService: NotificationService,
    private readonly inventoryMovementService: InventoryMovementService,
    private readonly dataSource: DataSource,
    private readonly systemTimeService: SystemTimeService,
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

    const committedAmount = this.toNumber(
      await this.repository.getCommittedRationsForCamp(supplierCampId, transfer.id),
    );

    const currentAmount = this.toNumber(rationInventory.currentAmount);
    const minimumAmount = this.toNumber(rationInventory.minimumAlertAmount);
    const availableAmount = currentAmount - committedAmount;
    const remainingAmount = availableAmount - rationsForTrip;

    if (availableAmount < rationsForTrip) {
      throw new BadRequestException('Inventario insuficiente de raciones para ejecutar el traslado');
    }

    if (remainingAmount < minimumAmount) {
      throw new BadRequestException(
        'El traslado dejaria las raciones por debajo del minimo permitido',
      );
    }
  }

  private async applyTransferRations(
    manager: EntityManager,
    transfer: Transfer,
    actorUserId: number,
  ): Promise<void> {
    const alreadyApplied = await this.repository.countAppliedTransferRationMovementsWithManager(
      manager,
      transfer.id,
    );
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
    const rationInventory = await this.repository.findRationInventoryCandidateWithManager(
      manager,
      supplierCampId,
    );
    if (!rationInventory) {
      throw new BadRequestException('No hay recurso FOOD configurado para raciones del traslado');
    }

    await this.repository.createInventoryMovementWithManager(manager, {
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
    const inventory = await this.repository.getCampInventoryAmounts(campId, resourceTypeId);

    const currentAmount = this.toNumber(inventory?.currentAmount);
    const minimumAmount = this.toNumber(inventory?.minimumAlertAmount);
    const consumedAmount = this.toNumber(amount);

    if (currentAmount < consumedAmount) {
      throw new BadRequestException('Inventario insuficiente para ejecutar el traslado');
    }

    if (currentAmount - consumedAmount < minimumAmount) {
      throw new BadRequestException('El traslado dejaria inventario por debajo del minimo');
    }
  }

  private async ensureDeliveredResourcesFromRequest(
    manager: EntityManager,
    transferId: number,
    requestId: number,
    actorUserId: number,
  ): Promise<void> {
    const existing = await this.repository.findDeliveredResourcesByTransferIdWithManager(
      manager,
      transferId,
    );
    if (existing.length > 0) {
      return;
    }

    const resourceRows = await this.repository.getRequestResourceDetailsWithManager(
      manager,
      requestId,
    );

    for (const row of resourceRows) {
      const alreadyExists = await this.repository.findDeliveredResourceByTransferAndTypeWithManager(
        manager,
        transferId,
        row.resourceTypeId,
      );

      if (!alreadyExists) {
        await this.repository.insertDeliveredTransferResourceWithManager(
          manager,
          transferId,
          row.resourceTypeId,
          row.amount,
          actorUserId,
        );
      }
    }
  }

  private async applyTransferSentInventory(
    manager: EntityManager,
    transferId: number,
    requestId: number,
    actorUserId: number,
  ): Promise<void> {
    await this.ensureDeliveredResourcesFromRequest(manager, transferId, requestId, actorUserId);

    const alreadyApplied = await this.repository.countAppliedTransferSentMovementsWithManager(
      manager,
      transferId,
    );
    if (alreadyApplied > 0) {
      return;
    }

    const scope = await this.resolveRequestScope(requestId);
    const supplierCampId = scope.destinationCampId;
    const deliveredRows = await this.repository.findDeliveredResourcesByTransferIdWithManager(
      manager,
      transferId,
    );

    for (const delivered of deliveredRows) {
      const inventory = await this.repository.getCampInventoryAmountsWithManager(
        manager,
        supplierCampId,
        delivered.resourceTypeId,
      );
      const currentAmount = this.toNumber(inventory?.currentAmount);
      const sentAmount = this.toNumber(delivered.sentAmount);
      const actualSent = Math.min(sentAmount, currentAmount);

      if (actualSent <= 0) {
        continue;
      }

      await this.repository.createInventoryMovementWithManager(manager, {
        campId: supplierCampId,
        resourceTypeId: delivered.resourceTypeId,
        amount: this.roundToTwo(actualSent),
        movementType: 'TRANSFER_SENT',
        sourceId: transferId,
        sourceType: 'transfer',
        recordedBy: actorUserId,
        description: `Transfer sent: transfer #${transferId} resource #${delivered.resourceTypeId}`,
      });
    }
  }

  private async applyTransferReceivedInventory(
    manager: EntityManager,
    transferId: number,
    requestId: number,
    actorUserId: number,
  ): Promise<void> {
    await this.ensureDeliveredResourcesFromRequest(manager, transferId, requestId, actorUserId);

    const alreadyApplied = await this.repository.countAppliedTransferReceivedMovementsWithManager(
      manager,
      transferId,
    );
    if (alreadyApplied > 0) {
      return;
    }

    const scope = await this.resolveRequestScope(requestId);
    const recipientCampId = scope.originCampId;
    const deliveredRows = await this.repository.findDeliveredResourcesByTransferIdWithManager(
      manager,
      transferId,
    );

    for (const delivered of deliveredRows) {
      const receivedAmount = this.toNumber(delivered.receivedAmount);
      if (receivedAmount <= 0) {
        continue;
      }

      await this.repository.createInventoryMovementWithManager(manager, {
        campId: recipientCampId,
        resourceTypeId: delivered.resourceTypeId,
        amount: this.roundToTwo(receivedAmount),
        movementType: 'TRANSFER_RECEIVED',
        sourceId: transferId,
        sourceType: 'transfer',
        recordedBy: actorUserId,
        description: `Transfer received: transfer #${transferId} resource #${delivered.resourceTypeId}`,
      });
    }
  }

  private async createTransferHistoryEntry(
    manager: EntityManager,
    transferId: number,
    previousStatus: TransferStatus,
    newStatus: TransferStatus,
    userId: number,
  ): Promise<void> {
    await this.repository.createTransferHistoryEntryWithManager(manager, {
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
      updateData.actualDepartureDate = updateData.actualDepartureDate ?? this.systemTimeService.now();
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
        updateData.actualDepartureDate ?? existing.actualDepartureDate ?? this.systemTimeService.now();
      updateData.actualArrivalDate = updateData.actualArrivalDate ?? this.systemTimeService.now();
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

    return await this.dataSource.transaction(async (manager) => {
      const updated = await this.repository.updateWithManager(manager, id, updateData);
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
          await this.repository.setManifestInTransitWithManager(
            manager,
            updated.id,
            updated.actualDepartureDate ?? this.systemTimeService.now(),
          );
          await this.applyTransferRations(manager, updated, actorUserId);
          await this.applyTransferSentInventory(manager, updated.id, updated.requestId, actorUserId);
        }

        if (updated.status === 'COMPLETED') {
          const skipFromPending = existing.status === 'PENDING_DEPARTURE';
          const departureDate = updated.actualDepartureDate ?? existing.plannedDepartureDate ?? this.systemTimeService.now();
          const arrivalDate = updated.actualArrivalDate ?? this.systemTimeService.now();

          if (skipFromPending) {
            await this.repository.setManifestInTransitWithManager(manager, updated.id, departureDate);
            await this.applyTransferRations(manager, updated, actorUserId);
            await this.applyTransferSentInventory(manager, updated.id, updated.requestId, actorUserId);
          }

          await this.applyTransferReceivedInventory(manager, updated.id, updated.requestId, actorUserId);
          await this.repository.completeManifestWithManager(manager, updated.id, updated.requestId, arrivalDate);
        }

        if (updated.status === 'CANCELED') {
          await this.repository.cancelManifestWithManager(manager, updated.id);
        }

        await this.createTransferHistoryEntry(
          manager,
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

        void this.notificationService.notifyCampRoles(
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
        void this.notificationService.notifyCampRoles(
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
    });
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

    const committedAmount = this.toNumber(
      await this.repository.getCommittedRationsForCamp(supplierCampId, transfer.id),
    );

    const currentAmount = this.toNumber(rationInventory.currentAmount);
    const minimumAmount = this.toNumber(rationInventory.minimumAlertAmount);
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

    const people = await this.repository.getTransportStaffForTransfer(
      uniquePersonIds,
      supplierCampId,
    );

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

    const busyPersonIds = await this.repository.findBusyPersonIds(uniquePersonIds, id);
    if (busyPersonIds.length > 0) {
      throw new BadRequestException(
        'Una o mas personas operativas ya estan asignadas a otro traslado activo',
      );
    }

    const rationsForTrip = await this.assertTransportStaffRationsAvailable(
      existing,
      supplierCampId,
      uniquePersonIds.length,
    );

    try {
      await this.repository.replaceTransportStaff(id, uniquePersonIds, rationsForTrip);
    } catch (error) {
      if (error instanceof Error && error.message === 'LOCK_FAILED') {
        throw new BadRequestException('Solo se puede editar personal operativo antes de la salida');
      }
      throw error;
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

  /**
   * Executes a transfer status transition automatically (bypassing manual validations
   * such as transport staff check and rations availability). Used by temporal automation
   * when the planned departure/arrival date is reached after advancing system time.
   *
   * Phase 1 — status update — is always committed.
   * Phase 2 — inventory/manifest operations — run best-effort; errors are logged but
   * do NOT roll back the status change.
   */
  async executeAutomatedTransfer(
    id: number,
    newStatus: 'IN_TRANSIT' | 'COMPLETED',
    dates: {
      actualDepartureDate?: Date;
      actualArrivalDate?: Date;
    },
  ): Promise<Transfer | null> {
    const existing = await this.repository.findById(id);
    if (!existing) return null;

    if (existing.status === 'COMPLETED' || existing.status === 'CANCELED') {
      return existing;
    }

    const now = this.systemTimeService.now();
    const scope = await this.resolveRequestScope(existing.requestId);
    const actorUserId = scope.respondedBy ?? scope.createdBy;

    const updateData: UpdateTransferDTO = { status: newStatus };

    if (newStatus === 'IN_TRANSIT') {
      updateData.actualDepartureDate = dates.actualDepartureDate ?? now;
    }

    if (newStatus === 'COMPLETED') {
      updateData.departureApprovedBy = existing.departureApprovedBy ?? actorUserId;
      updateData.arrivalApprovedBy = existing.arrivalApprovedBy ?? actorUserId;
      updateData.actualDepartureDate =
        dates.actualDepartureDate ??
        existing.actualDepartureDate ??
        existing.plannedDepartureDate ??
        now;
      updateData.actualArrivalDate = dates.actualArrivalDate ?? now;
    }

    // ── Phase 1: Persist status change unconditionally ────────────────────────
    const updated = await this.dataSource.transaction(async (manager) => {
      return await this.repository.updateWithManager(manager, id, updateData);
    });

    if (!updated) return null;

    if (updated.status === existing.status) {
      return updated;
    }

    // ── Phase 2: Apply inventory / manifest (best-effort) ────────────────────
    const resolvedActorUserId =
      updated.arrivalApprovedBy ?? updated.departureApprovedBy ?? actorUserId;

    // ── Phase 2: Apply inventory / manifest (best-effort, granular) ─────────
    if (updated.status === 'IN_TRANSIT') {
      // 2a. Mark manifest as in transit
      try {
        await this.dataSource.transaction(async (manager) => {
          await this.repository.setManifestInTransitWithManager(
            manager,
            updated.id,
            updated.actualDepartureDate ?? now,
          );
          await this.applyTransferRationsSafe(manager, updated, resolvedActorUserId);
          await this.applyTransferSentInventory(manager, updated.id, updated.requestId, resolvedActorUserId);
          await this.createTransferHistoryEntry(manager, updated.id, existing.status, updated.status, resolvedActorUserId);
        });
      } catch (err) {
        this.logger.warn(
          `[executeAutomated] Transfer #${id} IN_TRANSIT secondary ops failed: ${err instanceof Error ? err.message : String(err)}\n${err instanceof Error ? err.stack : ''}`,
        );
      }
    }

    if (updated.status === 'COMPLETED') {
      const skipFromPending = existing.status === 'PENDING_DEPARTURE';
      const departureDate = updated.actualDepartureDate ?? (existing as Transfer).plannedDepartureDate ?? now;
      const arrivalDate = updated.actualArrivalDate ?? now;

      // 2b. Departure side (only if skipping from PENDING_DEPARTURE)
      if (skipFromPending) {
        try {
          await this.dataSource.transaction(async (manager) => {
            await this.repository.setManifestInTransitWithManager(manager, updated.id, departureDate);
            await this.applyTransferRationsSafe(manager, updated, resolvedActorUserId);
            await this.applyTransferSentInventory(manager, updated.id, updated.requestId, resolvedActorUserId);
          });
        } catch (err) {
          this.logger.warn(
            `[executeAutomated] Transfer #${id} COMPLETED departure ops failed: ${err instanceof Error ? err.message : String(err)}\n${err instanceof Error ? err.stack : ''}`,
          );
        }
      }

      // 2c. Arrival / complete manifest
      try {
        await this.dataSource.transaction(async (manager) => {
          await this.applyTransferReceivedInventory(manager, updated.id, updated.requestId, resolvedActorUserId);
          await this.repository.completeManifestWithManager(manager, updated.id, updated.requestId, arrivalDate);
          await this.createTransferHistoryEntry(manager, updated.id, existing.status, updated.status, resolvedActorUserId);
        });
      } catch (err) {
        this.logger.warn(
          `[executeAutomated] Transfer #${id} COMPLETED arrival/manifest ops failed: ${err instanceof Error ? err.message : String(err)}\n${err instanceof Error ? err.stack : ''}`,
        );
      }
    }

    // Notifications always sent regardless of inventory result
    const notificationType = updated.status === 'COMPLETED' ? 'TRANSFER_COMPLETED' : 'TRANSFER_PENDING';
    const title =
      updated.status === 'COMPLETED' ? 'Traslado completado automaticamente' : 'Traslado en transito';
    const message = `El traslado #${updated.id} cambio automaticamente su estado a ${updated.status}.`;

    void this.notificationService.notifyCampRoles(
      scope.originCampId,
      ['SYSTEM_ADMIN', 'RESOURCE_MANAGEMENT', 'TRAVEL_MANAGER'],
      { type: notificationType, title, message, sourceType: 'transfer', sourceId: updated.id },
    );
    void this.notificationService.notifyCampRoles(
      scope.destinationCampId,
      ['SYSTEM_ADMIN', 'RESOURCE_MANAGEMENT', 'TRAVEL_MANAGER'],
      { type: notificationType, title, message, sourceType: 'transfer', sourceId: updated.id },
    );

    return updated;
  }

  /**
   * Like applyTransferRations but skips silently when rationsForTrip <= 0 or
   * when no FOOD resource is configured, instead of throwing.
   */
  private async applyTransferRationsSafe(
    manager: EntityManager,
    transfer: Transfer,
    actorUserId: number,
  ): Promise<void> {
    const alreadyApplied = await this.repository.countAppliedTransferRationMovementsWithManager(
      manager,
      transfer.id,
    );
    if (alreadyApplied > 0) return;

    const refreshed = await this.repository.findById(transfer.id);
    const rationsForTrip = this.toNumber(refreshed?.rationsForTrip ?? transfer.rationsForTrip);
    if (rationsForTrip <= 0) return; // Nothing to apply — skip silently

    const scope = await this.resolveRequestScope(transfer.requestId);
    const supplierCampId = scope.destinationCampId;
    const rationInventory = await this.repository.findRationInventoryCandidateWithManager(
      manager,
      supplierCampId,
    );
    if (!rationInventory) return; // No FOOD resource configured — skip silently

    await this.repository.createInventoryMovementWithManager(manager, {
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
}

