import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { IntercampRequestEntity } from '../intercampRequest/intercampRequest.entity';
import { TransferPersonEntity } from '../transferPerson/transferPerson.entity';
import { TransferEntity } from './transfer.entity';
import type {
  CreateTransferDTO,
  Transfer,
  TransferStatus,
  UpdateTransferDTO,
} from './transfer.model';

@Injectable()
export class TransferRepository {
  constructor(
    @InjectRepository(TransferEntity)
    private readonly repo: Repository<TransferEntity>,
  ) {}

  async create(data: CreateTransferDTO): Promise<Transfer> {
    const entity = this.repo.create({
      requestId: data.requestId,
      plannedDepartureDate: data.plannedDepartureDate,
      actualDepartureDate: data.actualDepartureDate ?? null,
      plannedArrivalDate: data.plannedArrivalDate,
      actualArrivalDate: data.actualArrivalDate ?? null,
      status: data.status ?? 'PENDING_DEPARTURE',
      departureApprovedBy: data.departureApprovedBy ?? null,
      arrivalApprovedBy: data.arrivalApprovedBy ?? null,
      rationsForTrip: data.rationsForTrip ?? '0.00',
      receptionNotes: data.receptionNotes ?? null,
    });

    return await this.repo.save(entity);
  }

  async findById(id: number): Promise<Transfer | null> {
    return await this.repo.findOne({ where: { id } });
  }

  async findByRequestId(requestId: number): Promise<Transfer | null> {
    return await this.repo.findOne({ where: { requestId } });
  }

  async countTransferPeople(transferId: number): Promise<number> {
    const transportStaffCount = await this.repo.manager
      .getRepository(TransferPersonEntity)
      .createQueryBuilder('tp')
      .where('tp.transferId = :transferId', { transferId })
      .andWhere('tp.status <> :canceled', { canceled: 'CANCELED' })
      .getCount();

    const rows = (await this.repo.query(
      `SELECT COUNT(*)::int AS total
       FROM public.transfer_requested_person
       WHERE transfer_id = $1
         AND status <> 'CANCELED'`,
      [transferId],
    )) as Array<{ total: number }>;

    return transportStaffCount + (rows[0]?.total ?? 0);
  }

  async countTransferTransportStaff(transferId: number): Promise<number> {
    return await this.repo.manager
      .getRepository(TransferPersonEntity)
      .createQueryBuilder('tp')
      .where('tp.transferId = :transferId', { transferId })
      .andWhere('tp.status <> :canceled', { canceled: 'CANCELED' })
      .getCount();
  }

  async countTransferRequestedPeople(transferId: number): Promise<number> {
    const rows = (await this.repo.query(
      `SELECT COUNT(*)::int AS total
       FROM public.transfer_requested_person
       WHERE transfer_id = $1
         AND status <> 'CANCELED'`,
      [transferId],
    )) as Array<{ total: number }>;

    return rows[0]?.total ?? 0;
  }

  async countAppliedTransferRationMovements(transferId: number): Promise<number> {
    const rows = (await this.repo.query(
      `SELECT COUNT(*)::int AS total
       FROM public.inventory_movement
       WHERE source_type = 'transfer_rations'
         AND source_id = $1
         AND movement_type = 'DAILY_RATION'`,
      [transferId],
    )) as Array<{ total: number }>;

    return rows[0]?.total ?? 0;
  }

  async countAppliedTransferRationMovementsWithManager(
    manager: EntityManager,
    transferId: number,
  ): Promise<number> {
    const rows = (await manager.query(
      `SELECT COUNT(*)::int AS total
       FROM public.inventory_movement
       WHERE source_type = 'transfer_rations'
         AND source_id = $1
         AND movement_type = 'DAILY_RATION'`,
      [transferId],
    )) as Array<{ total: number }>;

    return rows[0]?.total ?? 0;
  }

  async countAppliedTransferSentMovements(transferId: number): Promise<number> {
    const rows = (await this.repo.query(
      `SELECT COUNT(*)::int AS total
       FROM public.inventory_movement
       WHERE source_type = 'transfer'
         AND source_id = $1
         AND movement_type = 'TRANSFER_SENT'`,
      [transferId],
    )) as Array<{ total: number }>;

    return rows[0]?.total ?? 0;
  }

  async countAppliedTransferSentMovementsWithManager(
    manager: EntityManager,
    transferId: number,
  ): Promise<number> {
    const rows = (await manager.query(
      `SELECT COUNT(*)::int AS total
       FROM public.inventory_movement
       WHERE source_type = 'transfer'
         AND source_id = $1
         AND movement_type = 'TRANSFER_SENT'`,
      [transferId],
    )) as Array<{ total: number }>;

    return rows[0]?.total ?? 0;
  }

  async countAppliedTransferReceivedMovements(transferId: number): Promise<number> {
    const rows = (await this.repo.query(
      `SELECT COUNT(*)::int AS total
       FROM public.inventory_movement
       WHERE source_type = 'transfer'
         AND source_id = $1
         AND movement_type = 'TRANSFER_RECEIVED'`,
      [transferId],
    )) as Array<{ total: number }>;

    return rows[0]?.total ?? 0;
  }

  async countAppliedTransferReceivedMovementsWithManager(
    manager: EntityManager,
    transferId: number,
  ): Promise<number> {
    const rows = (await manager.query(
      `SELECT COUNT(*)::int AS total
       FROM public.inventory_movement
       WHERE source_type = 'transfer'
         AND source_id = $1
         AND movement_type = 'TRANSFER_RECEIVED'`,
      [transferId],
    )) as Array<{ total: number }>;

    return rows[0]?.total ?? 0;
  }

  async findRationInventoryCandidate(campId: number): Promise<{
    resourceTypeId: number;
    currentAmount: string;
    minimumAlertAmount: string;
  } | null> {
    const rows = (await this.repo.query(
      `SELECT ci.resource_type_id,
              ci.current_amount::text AS current_amount,
              ci.minimum_alert_amount::text AS minimum_alert_amount
       FROM public.camp_inventory ci
       INNER JOIN public.resource_type rt ON rt.id = ci.resource_type_id
       WHERE ci.camp_id = $1
         AND rt.category = 'FOOD'
       ORDER BY
         CASE
           WHEN LOWER(rt.name) LIKE '%ration%' THEN 0
           WHEN LOWER(rt.name) LIKE '%food%' THEN 1
           ELSE 2
         END,
         ci.resource_type_id ASC
       LIMIT 1`,
      [campId],
    )) as Array<{
      resource_type_id: number;
      current_amount: string;
      minimum_alert_amount: string;
    }>;

    const row = rows[0];
    if (!row) return null;

    return {
      resourceTypeId: row.resource_type_id,
      currentAmount: row.current_amount,
      minimumAlertAmount: row.minimum_alert_amount,
    };
  }

  async findRationInventoryCandidateWithManager(
    manager: EntityManager,
    campId: number,
  ): Promise<{
    resourceTypeId: number;
    currentAmount: string;
    minimumAlertAmount: string;
  } | null> {
    const rows = (await manager.query(
      `SELECT ci.resource_type_id,
              ci.current_amount::text AS current_amount,
              ci.minimum_alert_amount::text AS minimum_alert_amount
       FROM public.camp_inventory ci
       INNER JOIN public.resource_type rt ON rt.id = ci.resource_type_id
       WHERE ci.camp_id = $1
         AND rt.category = 'FOOD'
       ORDER BY
         CASE
           WHEN LOWER(rt.name) LIKE '%ration%' THEN 0
           WHEN LOWER(rt.name) LIKE '%food%' THEN 1
           ELSE 2
         END,
         ci.resource_type_id ASC
       LIMIT 1`,
      [campId],
    )) as Array<{
      resource_type_id: number;
      current_amount: string;
      minimum_alert_amount: string;
    }>;

    const row = rows[0];
    if (!row) return null;

    return {
      resourceTypeId: row.resource_type_id,
      currentAmount: row.current_amount,
      minimumAlertAmount: row.minimum_alert_amount,
    };
  }

  async getCommittedRationsForCamp(campId: number, excludeTransferId: number): Promise<string> {
    const rows = (await this.repo.query(
      `SELECT COALESCE(SUM(t.rations_for_trip), 0)::text AS total
       FROM public.transfer t
       INNER JOIN public.intercamp_request r ON r.id = t.request_id
       WHERE r.destination_camp_id = $1
         AND r.status = 'APPROVED'
         AND t.status = 'PENDING_DEPARTURE'
         AND t.id <> $2`,
      [campId, excludeTransferId],
    )) as Array<{ total: string }>;

    return rows[0]?.total ?? '0';
  }

  async getCampInventoryAmounts(
    campId: number,
    resourceTypeId: number,
  ): Promise<{ currentAmount: string; minimumAlertAmount: string } | null> {
    const rows = (await this.repo.query(
      `SELECT current_amount::text AS current_amount,
              minimum_alert_amount::text AS minimum_alert_amount
       FROM public.camp_inventory
       WHERE camp_id = $1
         AND resource_type_id = $2
       LIMIT 1`,
      [campId, resourceTypeId],
    )) as Array<{ current_amount: string; minimum_alert_amount: string }>;

    const row = rows[0];
    if (!row) return null;

    return {
      currentAmount: row.current_amount,
      minimumAlertAmount: row.minimum_alert_amount,
    };
  }

  async getCampInventoryAmountsWithManager(
    manager: EntityManager,
    campId: number,
    resourceTypeId: number,
  ): Promise<{ currentAmount: string; minimumAlertAmount: string } | null> {
    const rows = (await manager.query(
      `SELECT current_amount::text AS current_amount,
              minimum_alert_amount::text AS minimum_alert_amount
       FROM public.camp_inventory
       WHERE camp_id = $1
         AND resource_type_id = $2
       LIMIT 1`,
      [campId, resourceTypeId],
    )) as Array<{ current_amount: string; minimum_alert_amount: string }>;

    const row = rows[0];
    if (!row) return null;

    return {
      currentAmount: row.current_amount,
      minimumAlertAmount: row.minimum_alert_amount,
    };
  }

  async getRequestResourceDetails(
    requestId: number,
  ): Promise<Array<{ resourceTypeId: number; amount: string }>> {
    const rows = (await this.repo.query(
      `SELECT resource_type_id,
              COALESCE(approved_amount, requested_amount)::text AS amount
       FROM public.request_resource_detail
       WHERE request_id = $1`,
      [requestId],
    )) as Array<{ resource_type_id: number; amount: string }>;

    return rows.map((row) => ({
      resourceTypeId: row.resource_type_id,
      amount: row.amount,
    }));
  }

  async getRequestResourceDetailsWithManager(
    manager: EntityManager,
    requestId: number,
  ): Promise<Array<{ resourceTypeId: number; amount: string }>> {
    const rows = (await manager.query(
      `SELECT resource_type_id,
              COALESCE(approved_amount, requested_amount)::text AS amount
       FROM public.request_resource_detail
       WHERE request_id = $1`,
      [requestId],
    )) as Array<{ resource_type_id: number; amount: string }>;

    return rows.map((row) => ({
      resourceTypeId: row.resource_type_id,
      amount: row.amount,
    }));
  }

  async findDeliveredResourceByTransferAndType(
    transferId: number,
    resourceTypeId: number,
  ): Promise<boolean> {
    const rows = (await this.repo.query(
      `SELECT 1
       FROM public.delivered_transfer_resource
       WHERE transfer_id = $1
         AND resource_type_id = $2
       LIMIT 1`,
      [transferId, resourceTypeId],
    )) as unknown[];

    return rows.length > 0;
  }

  async findDeliveredResourceByTransferAndTypeWithManager(
    manager: EntityManager,
    transferId: number,
    resourceTypeId: number,
  ): Promise<boolean> {
    const rows = (await manager.query(
      `SELECT 1
       FROM public.delivered_transfer_resource
       WHERE transfer_id = $1
         AND resource_type_id = $2
       LIMIT 1`,
      [transferId, resourceTypeId],
    )) as unknown[];

    return rows.length > 0;
  }

  async insertDeliveredTransferResource(
    transferId: number,
    resourceTypeId: number,
    amount: string,
  ): Promise<void> {
    await this.repo.query(
      `INSERT INTO public.delivered_transfer_resource
         (transfer_id, resource_type_id, sent_amount, received_amount, record_date)
       VALUES ($1, $2, $3, $3, NOW())`,
      [transferId, resourceTypeId, amount],
    );
  }

  async insertDeliveredTransferResourceWithManager(
    manager: EntityManager,
    transferId: number,
    resourceTypeId: number,
    amount: string,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO public.delivered_transfer_resource
         (transfer_id, resource_type_id, sent_amount, received_amount, record_date)
       VALUES ($1, $2, $3, $3, NOW())`,
      [transferId, resourceTypeId, amount],
    );
  }

  async findDeliveredResourcesByTransferId(transferId: number): Promise<
    Array<{
      id: number;
      resourceTypeId: number;
      sentAmount: string;
      receivedAmount: string;
    }>
  > {
    const rows = (await this.repo.query(
      `SELECT id,
              resource_type_id,
              sent_amount::text AS sent_amount,
              received_amount::text AS received_amount
       FROM public.delivered_transfer_resource
       WHERE transfer_id = $1`,
      [transferId],
    )) as Array<{
      id: number;
      resource_type_id: number;
      sent_amount: string;
      received_amount: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      resourceTypeId: row.resource_type_id,
      sentAmount: row.sent_amount,
      receivedAmount: row.received_amount,
    }));
  }

  async findDeliveredResourcesByTransferIdWithManager(
    manager: EntityManager,
    transferId: number,
  ): Promise<
    Array<{
      id: number;
      resourceTypeId: number;
      sentAmount: string;
      receivedAmount: string;
    }>
  > {
    const rows = (await manager.query(
      `SELECT id,
              resource_type_id,
              sent_amount::text AS sent_amount,
              received_amount::text AS received_amount
       FROM public.delivered_transfer_resource
       WHERE transfer_id = $1`,
      [transferId],
    )) as Array<{
      id: number;
      resource_type_id: number;
      sent_amount: string;
      received_amount: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      resourceTypeId: row.resource_type_id,
      sentAmount: row.sent_amount,
      receivedAmount: row.received_amount,
    }));
  }

  async getTransportStaffForTransfer(
    personIds: number[],
    supplierCampId: number,
  ): Promise<
    Array<{
      id: number;
      camp_id: number;
      current_status: string;
      occupation_name: string | null;
    }>
  > {
    return (await this.repo.query(
      `SELECT p.id, p.camp_id, p.current_status, o.name AS occupation_name
       FROM public.person p
       LEFT JOIN public.occupation o ON o.id = p.occupation_id
       WHERE p.id = ANY($1::int[])`,
      [personIds],
    )) as Array<{
      id: number;
      camp_id: number;
      current_status: string;
      occupation_name: string | null;
    }>;
  }

  async findBusyPersonIds(personIds: number[], excludeTransferId: number): Promise<number[]> {
    const rows = (await this.repo.query(
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
      [personIds, excludeTransferId],
    )) as Array<{ person_id: number }>;

    return rows.map((row) => row.person_id);
  }

  async replaceTransportStaff(
    transferId: number,
    personIds: number[],
    rationsForTrip: string,
  ): Promise<void> {
    const queryRunner = this.repo.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const lockedRows = (await queryRunner.query(
        `SELECT id
         FROM public.transfer
         WHERE id = $1
           AND status = 'PENDING_DEPARTURE'
         FOR UPDATE`,
        [transferId],
      )) as Array<{ id: number }>;

      if (lockedRows.length === 0) {
        throw new Error('LOCK_FAILED');
      }

      await queryRunner.query(
        `UPDATE public.transfer_person
         SET status = 'CANCELED', departure_date = NULL, arrival_date = NULL
         WHERE transfer_id = $1
           AND person_id <> ALL($2::int[])
           AND status <> 'CANCELED'`,
        [transferId, personIds],
      );

      for (const personId of personIds) {
        const updatedRows = (await queryRunner.query(
          `UPDATE public.transfer_person
           SET status = 'CONFIRMED', departure_date = NULL, arrival_date = NULL
           WHERE transfer_id = $1
             AND person_id = $2
           RETURNING id`,
          [transferId, personId],
        )) as Array<{ id: number }>;

        if (updatedRows.length === 0) {
          await queryRunner.query(
            `INSERT INTO public.transfer_person (transfer_id, person_id, status, departure_date, arrival_date)
             VALUES ($1, $2, 'CONFIRMED', NULL, NULL)`,
            [transferId, personId],
          );
        }
      }

      await queryRunner.query(
        `UPDATE public.transfer
         SET rations_for_trip = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [transferId, rationsForTrip],
      );

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async setManifestInTransit(transferId: number, departureDate: Date): Promise<void> {
    await this.repo.manager.transaction(async (manager) => {
      await this.setManifestInTransitWithManager(manager, transferId, departureDate);
    });
  }

  async setManifestInTransitWithManager(
    manager: EntityManager,
    transferId: number,
    departureDate: Date,
  ): Promise<void> {
    await manager.query(
      `UPDATE public.transfer_person
       SET status = 'IN_TRANSIT',
           departure_date = COALESCE(departure_date, $2)
       WHERE transfer_id = $1
         AND status = 'CONFIRMED'`,
      [transferId, departureDate],
    );

    await manager.query(
      `UPDATE public.transfer_requested_person
       SET status = 'IN_TRANSIT',
           departure_date = COALESCE(departure_date, $2)
       WHERE transfer_id = $1
         AND status = 'CONFIRMED'`,
      [transferId, departureDate],
    );

    await manager.query(
      `UPDATE public.person
       SET current_status = 'OUTSIDE_CAMP',
           updated_at = NOW()
       WHERE id IN (
         SELECT person_id FROM public.transfer_person WHERE transfer_id = $1
         UNION
         SELECT person_id FROM public.transfer_requested_person WHERE transfer_id = $1
       )`,
      [transferId],
    );
  }

  async completeManifest(transferId: number, requestId: number, arrivalDate: Date): Promise<void> {
    const scope = await this.resolveRequestScope(requestId);
    if (!scope) return;

    await this.repo.manager.transaction(async (manager) => {
      await this.completeManifestWithManager(manager, transferId, requestId, arrivalDate);
    });
  }

  async completeManifestWithManager(
    manager: EntityManager,
    transferId: number,
    requestId: number,
    arrivalDate: Date,
  ): Promise<void> {
    const scope = await this.resolveRequestScopeWithManager(manager, requestId);
    if (!scope) return;

    await manager.query(
      `UPDATE public.transfer_person
       SET status = 'DELIVERED',
           arrival_date = COALESCE(arrival_date, $2)
       WHERE transfer_id = $1
         AND status <> 'CANCELED'`,
      [transferId, arrivalDate],
    );

    await manager.query(
      `UPDATE public.person
       SET current_status = 'ACTIVE',
           updated_at = NOW()
       WHERE id IN (
         SELECT person_id FROM public.transfer_person WHERE transfer_id = $1
       )`,
      [transferId],
    );

    await manager.query(
      `UPDATE public.transfer_requested_person
       SET status = 'DELIVERED',
           arrival_date = COALESCE(arrival_date, $2)
       WHERE transfer_id = $1
         AND status <> 'CANCELED'`,
      [transferId, arrivalDate],
    );

    await manager.query(
      `UPDATE public.person
       SET camp_id = $2,
           current_status = 'ACTIVE',
           updated_at = NOW()
       WHERE id IN (
         SELECT person_id FROM public.transfer_requested_person WHERE transfer_id = $1
       )`,
      [transferId, scope.originCampId],
    );

    await manager.query(
      `UPDATE public.system_user
       SET camp_id = $2,
           updated_at = NOW()
       WHERE person_id IN (
         SELECT person_id FROM public.transfer_requested_person WHERE transfer_id = $1
       )`,
      [transferId, scope.originCampId],
    );
  }

  async cancelManifest(transferId: number): Promise<void> {
    await this.repo.manager.transaction(async (manager) => {
      await this.cancelManifestWithManager(manager, transferId);
    });
  }

  async cancelManifestWithManager(manager: EntityManager, transferId: number): Promise<void> {
    await manager.query(
      `UPDATE public.transfer_person
       SET status = 'CANCELED'
       WHERE transfer_id = $1
         AND status <> 'DELIVERED'`,
      [transferId],
    );

    await manager.query(
      `UPDATE public.transfer_requested_person
       SET status = 'CANCELED'
       WHERE transfer_id = $1
         AND status <> 'DELIVERED'`,
      [transferId],
    );

    await manager.query(
      `UPDATE public.person
       SET current_status = 'ACTIVE',
           updated_at = NOW()
       WHERE current_status = 'OUTSIDE_CAMP'
         AND id IN (
           SELECT person_id FROM public.transfer_person WHERE transfer_id = $1
           UNION
           SELECT person_id FROM public.transfer_requested_person WHERE transfer_id = $1
         )`,
      [transferId],
    );
  }

  async resolveRequestScope(requestId: number): Promise<{
    originCampId: number;
    destinationCampId: number;
    createdBy: number;
    respondedBy: number | null;
  } | null> {
    const request = await this.repo.manager.getRepository(IntercampRequestEntity).findOne({
      where: { id: requestId },
      select: {
        originCampId: true,
        destinationCampId: true,
        createdBy: true,
        respondedBy: true,
      },
    });

    if (!request) {
      return null;
    }

    return {
      originCampId: request.originCampId,
      destinationCampId: request.destinationCampId,
      createdBy: request.createdBy,
      respondedBy: request.respondedBy,
    };
  }

  async resolveRequestScopeWithManager(
    manager: EntityManager,
    requestId: number,
  ): Promise<{
    originCampId: number;
    destinationCampId: number;
    createdBy: number;
    respondedBy: number | null;
  } | null> {
    const request = await manager.getRepository(IntercampRequestEntity).findOne({
      where: { id: requestId },
      select: {
        originCampId: true,
        destinationCampId: true,
        createdBy: true,
        respondedBy: true,
      },
    });

    if (!request) {
      return null;
    }

    return {
      originCampId: request.originCampId,
      destinationCampId: request.destinationCampId,
      createdBy: request.createdBy,
      respondedBy: request.respondedBy,
    };
  }

  async resolveTransferScope(transferId: number): Promise<{
    originCampId: number;
    destinationCampId: number;
  } | null> {
    const rows = (await this.repo.query(
      `SELECT r.origin_camp_id, r.destination_camp_id
       FROM public.transfer t
       JOIN public.intercamp_request r ON r.id = t.request_id
       WHERE t.id = $1
       LIMIT 1`,
      [transferId],
    )) as Array<{ origin_camp_id: number; destination_camp_id: number }>;

    const row = rows[0];
    if (!row) return null;

    return {
      originCampId: row.origin_camp_id,
      destinationCampId: row.destination_camp_id,
    };
  }

  async createTransferHistoryEntry(data: {
    transferId: number;
    previousStatus: TransferStatus;
    newStatus: TransferStatus;
    userId: number;
    comment: string;
  }): Promise<void> {
    await this.repo.query(
      `INSERT INTO public.transfer_history (
          transfer_id,
          previous_status,
          new_status,
          user_id,
          comment
       ) VALUES ($1, $2, $3, $4, $5)`,
      [data.transferId, data.previousStatus, data.newStatus, data.userId, data.comment],
    );
  }

  async createTransferHistoryEntryWithManager(
    manager: EntityManager,
    data: {
      transferId: number;
      previousStatus: TransferStatus;
      newStatus: TransferStatus;
      userId: number;
      comment: string;
    },
  ): Promise<void> {
    await manager.query(
      `INSERT INTO public.transfer_history (
          transfer_id,
          previous_status,
          new_status,
          user_id,
          comment
       ) VALUES ($1, $2, $3, $4, $5)`,
      [data.transferId, data.previousStatus, data.newStatus, data.userId, data.comment],
    );
  }

  async createInventoryMovementWithManager(
    manager: EntityManager,
    data: {
      campId: number;
      resourceTypeId: number;
      amount: string;
      movementType: string;
      sourceId: number;
      sourceType: string;
      recordedBy: number;
      description: string;
    },
  ): Promise<void> {
    const isInflow = data.movementType === 'TRANSFER_RECEIVED';

    await manager.query(
      `INSERT INTO public.inventory_movement (
         camp_id,
         resource_type_id,
         amount,
         movement_type,
         source_id,
         source_type,
         recorded_by,
         date,
         description
       ) VALUES ($1, $2, $3::numeric, $4, $5, $6, $7, NOW(), $8)`,
      [
        data.campId,
        data.resourceTypeId,
        data.amount,
        data.movementType,
        data.sourceId,
        data.sourceType,
        data.recordedBy,
        data.description,
      ],
    );

    if (isInflow) {
      await manager.query(
        `UPDATE public.camp_inventory
         SET current_amount = current_amount + $1::numeric,
             last_update = NOW()
         WHERE camp_id = $2
           AND resource_type_id = $3`,
        [data.amount, data.campId, data.resourceTypeId],
      );
    } else {
      await manager.query(
        `UPDATE public.camp_inventory
         SET current_amount = current_amount - $1::numeric,
             last_update = NOW()
         WHERE camp_id = $2
           AND resource_type_id = $3`,
        [data.amount, data.campId, data.resourceTypeId],
      );
    }
  }


  async createRequestedPersonManifestFromRequest(
    transferId: number,
    requestId: number,
    supplierCampId: number,
  ): Promise<number> {
    return await this.repo.manager.transaction(async (manager) => {
      const specificRows = (await manager.query(
        `SELECT rpd.id AS detail_id, rpd.person_id
         FROM public.request_person_detail rpd
         INNER JOIN public.person p ON p.id = rpd.person_id
         WHERE rpd.request_id = $1
           AND rpd.detail_type = 'SPECIFIC'
           AND rpd.status <> 'REJECTED'
           AND rpd.person_id IS NOT NULL
           AND p.camp_id = $2
           AND p.current_status = 'ACTIVE'
           AND NOT EXISTS (
             SELECT 1
             FROM public.transfer_person tp
             INNER JOIN public.transfer t ON t.id = tp.transfer_id
             WHERE tp.person_id = p.id
               AND t.status IN ('PENDING_DEPARTURE', 'IN_TRANSIT')
           )
           AND NOT EXISTS (
             SELECT 1
             FROM public.transfer_requested_person trp
             INNER JOIN public.transfer t ON t.id = trp.transfer_id
             WHERE trp.person_id = p.id
               AND t.status IN ('PENDING_DEPARTURE', 'IN_TRANSIT')
           )`,
        [requestId, supplierCampId],
      )) as Array<{ detail_id: number; person_id: number }>;

      const specificExpectedRows = (await manager.query(
        `SELECT COUNT(*)::int AS total
         FROM public.request_person_detail
         WHERE request_id = $1
           AND detail_type = 'SPECIFIC'
           AND status <> 'REJECTED'
           AND person_id IS NOT NULL`,
        [requestId],
      )) as Array<{ total: number }>;

      if (specificRows.length !== (specificExpectedRows[0]?.total ?? 0)) {
        throw new Error('Una o mas personas especificas solicitadas no estan disponibles');
      }

      const requirementRows = (await manager.query(
        `SELECT id AS detail_id, occupation_id, amount
         FROM public.request_person_detail
         WHERE request_id = $1
           AND detail_type = 'BY_OCCUPATION'
           AND status <> 'REJECTED'
           AND occupation_id IS NOT NULL
           AND amount > 0
         ORDER BY id ASC`,
        [requestId],
      )) as Array<{ detail_id: number; occupation_id: number; amount: number }>;

      const selectedPersonIds = new Set<number>();
      const assignments: Array<{ detailId: number; personId: number }> = [];

      for (const row of specificRows) {
        selectedPersonIds.add(row.person_id);
        assignments.push({ detailId: row.detail_id, personId: row.person_id });
      }

      for (const requirement of requirementRows) {
        const eligibleRows = (await manager.query(
          `SELECT p.id
           FROM public.person p
           WHERE p.camp_id = $1
             AND p.occupation_id = $2
             AND p.current_status = 'ACTIVE'
             AND NOT EXISTS (
               SELECT 1
               FROM public.transfer_person tp
               INNER JOIN public.transfer t ON t.id = tp.transfer_id
                 WHERE tp.person_id = p.id
                 AND t.status IN ('PENDING_DEPARTURE', 'IN_TRANSIT')
             )
             AND NOT EXISTS (
               SELECT 1
               FROM public.transfer_requested_person trp
               INNER JOIN public.transfer t ON t.id = trp.transfer_id
                 WHERE trp.person_id = p.id
                 AND t.status IN ('PENDING_DEPARTURE', 'IN_TRANSIT')
             )
           ORDER BY p.created_at ASC, p.id ASC
           FOR UPDATE SKIP LOCKED`,
          [supplierCampId, requirement.occupation_id],
        )) as Array<{ id: number }>;

        const availableIds = eligibleRows
          .map((row) => row.id)
          .filter((personId) => !selectedPersonIds.has(personId));

        if (availableIds.length < requirement.amount) {
          throw new Error(
            `No hay suficientes personas elegibles para el oficio ${requirement.occupation_id}`,
          );
        }

        for (const personId of availableIds.slice(0, requirement.amount)) {
          selectedPersonIds.add(personId);
          assignments.push({ detailId: requirement.detail_id, personId });
        }
      }

      for (const assignment of assignments) {
        await manager.query(
          `INSERT INTO public.transfer_requested_person (
              transfer_id,
              request_person_detail_id,
              person_id,
              status
           ) VALUES ($1, $2, $3, 'CONFIRMED')
           ON CONFLICT (transfer_id, person_id)
           DO NOTHING`,
          [transferId, assignment.detailId, assignment.personId],
        );
      }

      return assignments.length;
    });
  }

  async findAllAndCount(filters?: {
    requestId?: number;
    status?: TransferStatus;
    offset?: number;
    limit?: number;
  }): Promise<{ data: Transfer[]; total: number }> {
    const qb = this.repo.createQueryBuilder('t');

    if (filters?.requestId !== undefined) {
      qb.andWhere('t.requestId = :requestId', { requestId: filters.requestId });
    }

    if (filters?.status !== undefined) {
      qb.andWhere('t.status = :status', { status: filters.status });
    }

    qb.orderBy('t.plannedDepartureDate', 'DESC');

    if (filters?.limit !== undefined) {
      qb.take(filters.limit);
    }

    if (filters?.offset !== undefined) {
      qb.skip(filters.offset);
    }

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async update(id: number, data: UpdateTransferDTO): Promise<Transfer | null> {
    const existing = await this.repo.findOne({ where: { id } });
    if (!existing) return null;

    const cleaned = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    ) as Partial<TransferEntity>;

    Object.assign(existing, cleaned);
    return await this.repo.save(existing);
  }

  async updateWithManager(
    manager: EntityManager,
    id: number,
    data: UpdateTransferDTO,
  ): Promise<Transfer | null> {
    const repo = manager.getRepository(TransferEntity);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) return null;

    const cleaned = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    ) as Partial<TransferEntity>;

    Object.assign(existing, cleaned);
    return await repo.save(existing);
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.repo.delete({ id });
    return (result.affected ?? 0) > 0;
  }

  async countAppliedTransferMovements(transferId: number): Promise<number> {
    const rows = (await this.repo.query(
      `SELECT COUNT(*)::int AS total
       FROM public.inventory_movement
       WHERE source_type = 'transfer'
         AND source_id = $1
         AND movement_type IN ('TRANSFER_SENT', 'TRANSFER_RECEIVED')`,
      [transferId],
    )) as Array<{ total: number }>;

    return rows[0]?.total ?? 0;
  }
}
