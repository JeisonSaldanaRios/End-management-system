import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

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
    const transportStaffCount = await this.repo.manager.getRepository(TransferPersonEntity)
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
    return await this.repo.manager.getRepository(TransferPersonEntity)
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

  async setManifestInTransit(transferId: number, departureDate: Date): Promise<void> {
    await this.repo.manager.transaction(async (manager) => {
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
    });
  }

  async completeManifest(
    transferId: number,
    requestId: number,
    arrivalDate: Date,
  ): Promise<void> {
    const scope = await this.resolveRequestScope(requestId);
    if (!scope) return;

    await this.repo.manager.transaction(async (manager) => {
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
    });
  }

  async cancelManifest(transferId: number): Promise<void> {
    await this.repo.manager.transaction(async (manager) => {
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
    });
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

  async delete(id: number): Promise<boolean> {
    const result = await this.repo.delete({ id });
    return (result.affected ?? 0) > 0;
  }
}
