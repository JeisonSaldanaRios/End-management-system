import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { ExpeditionParticipantEntity } from '../expeditionParticipant/expeditionParticipant.entity';
import { PersonEntity } from '../person/person.entity';
import { UserEntity } from '../systemUser/systemUser.entity';

import { ExpeditionEntity } from './expedition.entity';
import type {
  CreateExpeditionDTO,
  Expedition,
  ExpeditionStatus,
  UpdateExpeditionDTO,
} from './expedition.model';

@Injectable()
export class ExpeditionRepository {
  constructor(
    @InjectRepository(ExpeditionEntity)
    private readonly repo: Repository<ExpeditionEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async create(data: CreateExpeditionDTO): Promise<Expedition> {
    const entity = this.repo.create({
      campId: data.campId,
      name: data.name,
      objective: data.objective ?? null,
      destinationDescription: data.destinationDescription ?? null,
      destinationLatitude: data.destinationLatitude ?? null,
      destinationLongitude: data.destinationLongitude ?? null,
      ...(data.plannedDepartureDate !== undefined
        ? { plannedDepartureDate: data.plannedDepartureDate }
        : {}),
      actualDepartureDate: data.actualDepartureDate ?? null,
      ...(data.plannedReturnDate !== undefined
        ? { plannedReturnDate: data.plannedReturnDate }
        : {}),
      actualReturnDate: data.actualReturnDate ?? null,
      extraDaysAvailable: data.extraDaysAvailable ?? 0,
      extraDaysUsed: data.extraDaysUsed ?? 0,
      status: data.status ?? 'PLANNED',
    });

    return await this.repo.save(entity);
  }

  async findById(id: number): Promise<Expedition | null> {
    return await this.repo.findOne({ where: { id } });
  }

  async findPersonStatusById(
    personId: number,
  ): Promise<Pick<PersonEntity, 'id' | 'currentStatus'> | null> {
    return await this.dataSource.getRepository(PersonEntity).findOne({
      where: { id: personId },
      select: {
        id: true,
        currentStatus: true,
      },
    });
  }

  async updatePersonStatus(personId: number, status: PersonEntity['currentStatus']): Promise<void> {
    await this.dataSource
      .getRepository(PersonEntity)
      .update({ id: personId }, { currentStatus: status });
  }

  async getActiveParticipantPersonIds(expeditionId: number): Promise<number[]> {
    const participants = await this.dataSource.getRepository(ExpeditionParticipantEntity).find({
      where: {
        expeditionId,
        status: 'ACTIVE',
      },
      select: {
        personId: true,
      },
    });

    return [...new Set(participants.map((participant) => participant.personId))];
  }

  async getAllParticipantPersonIds(expeditionId: number): Promise<number[]> {
    const participants = await this.dataSource.getRepository(ExpeditionParticipantEntity).find({
      where: {
        expeditionId,
      },
      select: {
        personId: true,
      },
    });

    return [...new Set(participants.map((participant) => participant.personId))];
  }

  async getTrackedExpeditionStatusesByPersonId(personId: number): Promise<ExpeditionStatus[]> {
    const rows = await this.dataSource
      .getRepository(ExpeditionParticipantEntity)
      .createQueryBuilder('ep')
      .innerJoin(ExpeditionEntity, 'e', 'e.id = ep.expeditionId')
      .select('e.status', 'status')
      .where('ep.personId = :personId', { personId })
      .andWhere('ep.status = :participantStatus', { participantStatus: 'ACTIVE' })
      .andWhere('e.status IN (:...statuses)', { statuses: ['IN_PROGRESS', 'DELAYED', 'LOST'] })
      .getRawMany<{ status: ExpeditionStatus }>();

    return [...new Set(rows.map((row) => row.status))];
  }

  async findUserIdsByCampAndPersonIds(campId: number, personIds: number[]): Promise<number[]> {
    if (personIds.length === 0) {
      return [];
    }

    const users = await this.dataSource.getRepository(UserEntity).find({
      where: {
        campId,
        personId: In(personIds),
      },
      select: {
        id: true,
      },
    });

    return users.map((user) => user.id);
  }

  async isUserActiveParticipant(expeditionId: number, userId: number): Promise<boolean> {
    const count = await this.dataSource
      .getRepository(ExpeditionParticipantEntity)
      .createQueryBuilder('ep')
      .innerJoin(UserEntity, 'su', 'su.personId = ep.personId')
      .where('ep.expeditionId = :expeditionId', { expeditionId })
      .andWhere('su.id = :userId', { userId })
      .andWhere('ep.status = :status', { status: 'ACTIVE' })
      .getCount();

    return count > 0;
  }

  async findActiveParticipantPersonStatus(
    expeditionId: number,
    userId: number,
  ): Promise<Pick<PersonEntity, 'id' | 'currentStatus'> | null> {
    const row = await this.dataSource
      .getRepository(ExpeditionParticipantEntity)
      .createQueryBuilder('ep')
      .innerJoin(UserEntity, 'su', 'su.personId = ep.personId')
      .innerJoin(PersonEntity, 'p', 'p.id = ep.personId')
      .select('p.id', 'id')
      .addSelect('p.currentStatus', 'currentStatus')
      .where('ep.expeditionId = :expeditionId', { expeditionId })
      .andWhere('su.id = :userId', { userId })
      .andWhere('ep.status = :status', { status: 'ACTIVE' })
      .getRawOne<{ id: number; currentStatus: PersonEntity['currentStatus'] }>();

    return row ?? null;
  }

  async findByStatuses(statuses: ExpeditionStatus[], campId?: number): Promise<Expedition[]> {
    if (statuses.length === 0) {
      return [];
    }

    if (campId !== undefined) {
      return await this.repo.find({
        where: {
          status: In(statuses),
          campId,
        },
        order: { plannedDepartureDate: 'DESC' },
      });
    }

    return await this.repo.find({
      where: {
        status: In(statuses),
      },
      order: { plannedDepartureDate: 'DESC' },
    });
  }

  async findAllAndCount(filters?: {
    campId?: number;
    status?: ExpeditionStatus;
    offset?: number;
    limit?: number;
  }): Promise<{ data: Expedition[]; total: number }> {
    const qb = this.repo.createQueryBuilder('e');

    if (filters?.campId !== undefined) {
      qb.andWhere('e.campId = :campId', { campId: filters.campId });
    }

    if (filters?.status !== undefined) {
      qb.andWhere('e.status = :status', { status: filters.status });
    }

    qb.orderBy('e.plannedDepartureDate', 'DESC');

    if (filters?.limit !== undefined) {
      qb.take(filters.limit);
    }

    if (filters?.offset !== undefined) {
      qb.skip(filters.offset);
    }

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async update(id: number, data: UpdateExpeditionDTO): Promise<Expedition | null> {
    const existing = await this.repo.findOne({ where: { id } });
    if (!existing) return null;

    const cleaned = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    ) as Partial<ExpeditionEntity>;

    Object.assign(existing, cleaned);
    return await this.repo.save(existing);
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.repo.delete({ id });
    return (result.affected ?? 0) > 0;
  }

  async completeExplorationWithLoot(
    expedition: Expedition,
    completedBy: number,
    now: Date,
    completedStatus: Extract<ExpeditionStatus, 'COMPLETED' | 'RETURNED_AFTER_LOST'>,
  ): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const lootRows = (await queryRunner.query(
        `
        SELECT resource_type_id, SUM(amount)::numeric(12,2) AS total_amount
        FROM expedition_resource_obtained
        WHERE expedition_id = $1
        GROUP BY resource_type_id
        `,
        [expedition.id],
      )) as Array<{ resource_type_id: number; total_amount: string }>;

      if (lootRows.length === 0) {
        const resourceTypes = (await queryRunner.query(
          `
          SELECT id, category
          FROM resource_type
          WHERE category IN ('FOOD', 'WATER', 'MEDICAL', 'AMMUNITION')
          ORDER BY RANDOM()
          LIMIT 4
          `,
        )) as Array<{ id: number; category: string }>;

        for (const resourceType of resourceTypes) {
          const randomAmount = (Math.random() * 14 + 1).toFixed(2);

          await queryRunner.query(
            `
            INSERT INTO expedition_resource_obtained (
              expedition_id,
              resource_type_id,
              amount,
              recorded_by,
              record_date
            )
            VALUES ($1, $2, $3, $4, $5)
            `,
            [expedition.id, resourceType.id, randomAmount, completedBy, now.toISOString()],
          );

          lootRows.push({
            resource_type_id: resourceType.id,
            total_amount: randomAmount,
          });
        }
      }

      for (const row of lootRows) {
        await queryRunner.query(
          `
          INSERT INTO camp_inventory (camp_id, resource_type_id, current_amount, minimum_alert_amount, last_update)
          VALUES ($1, $2, $3, '0.00', $4)
          ON CONFLICT (camp_id, resource_type_id)
          DO UPDATE SET
            current_amount = (camp_inventory.current_amount::numeric + EXCLUDED.current_amount::numeric)::numeric(12,2),
            last_update = EXCLUDED.last_update
          `,
          [expedition.campId, row.resource_type_id, row.total_amount, now.toISOString()],
        );

        await queryRunner.query(
          `
          INSERT INTO inventory_movement (
            camp_id,
            resource_type_id,
            amount,
            movement_type,
            source_id,
            source_type,
            recorded_by,
            date,
            description
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [
            expedition.campId,
            row.resource_type_id,
            row.total_amount,
            'EXPEDITION_RETURN',
            expedition.id,
            'expedition_complete',
            completedBy,
            now.toISOString(),
            'Loot consolidated when expedition was completed',
          ],
        );
      }

      await queryRunner.query(
        `
        UPDATE expedition
        SET actual_return_date = $2,
            status = $3,
            updated_at = $2
        WHERE id = $1
        `,
        [expedition.id, now.toISOString(), completedStatus],
      );

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async applyDepartureProvisioningIfNeeded(expeditionId: number, now: Date): Promise<boolean> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const expeditionRows = (await queryRunner.query(
        `
        SELECT id, camp_id, planned_departure_date, planned_return_date, extra_days_available
        FROM expedition
        WHERE id = $1
        LIMIT 1
        `,
        [expeditionId],
      )) as Array<{
        id: number;
        camp_id: number;
        planned_departure_date: Date;
        planned_return_date: Date;
        extra_days_available: number;
      }>;

      const expedition = expeditionRows[0];
      if (!expedition) {
        await queryRunner.rollbackTransaction();
        return false;
      }

      const existingMovements = (await queryRunner.query(
        `
        SELECT COUNT(*)::int AS total
        FROM inventory_movement
        WHERE movement_type = 'EXPEDITION_DEPARTURE'
          AND source_id = $1
          AND source_type = 'expedition_departure_auto'
        `,
        [expeditionId],
      )) as Array<{ total: number }>;

      if ((existingMovements[0]?.total ?? 0) > 0) {
        await queryRunner.rollbackTransaction();
        return false;
      }

      const participantRows = (await queryRunner.query(
        `
        SELECT COUNT(*)::int AS total
        FROM expedition_participant
        WHERE expedition_id = $1
          AND status = 'ACTIVE'
        `,
        [expeditionId],
      )) as Array<{ total: number }>;

      const participantCount = participantRows[0]?.total ?? 0;
      if (participantCount <= 0) {
        await queryRunner.rollbackTransaction();
        return false;
      }

      const campRows = (await queryRunner.query(
        `
        SELECT minimum_daily_ration_per_person
        FROM camp
        WHERE id = $1
        LIMIT 1
        `,
        [expedition.camp_id],
      )) as Array<{ minimum_daily_ration_per_person: string }>;

      const rationPerPerson = Number.parseFloat(
        campRows[0]?.minimum_daily_ration_per_person ?? '1.00',
      );

      const resourceRows = (await queryRunner.query(
        `
        SELECT id, category
        FROM resource_type
        WHERE category IN ('FOOD', 'WATER')
        `,
      )) as Array<{ id: number; category: 'FOOD' | 'WATER' }>;

      if (resourceRows.length === 0) {
        await queryRunner.rollbackTransaction();
        return false;
      }

      const recorderRows = (await queryRunner.query(
        `
        SELECT id
        FROM public.system_user
        WHERE camp_id = $1
          AND status = 'ACTIVE'
          AND role IN ('RESOURCE_MANAGEMENT', 'SYSTEM_ADMIN')
        ORDER BY CASE role WHEN 'RESOURCE_MANAGEMENT' THEN 0 ELSE 1 END, id ASC
        LIMIT 1
        `,
        [expedition.camp_id],
      )) as Array<{ id: number }>;

      const recorder = recorderRows[0];
      if (!recorder) {
        await queryRunner.rollbackTransaction();
        return false;
      }

      const recorderId = recorder.id;
      const departureMs = new Date(expedition.planned_departure_date).getTime();
      const returnMs = new Date(expedition.planned_return_date).getTime();
      const baseDays = Math.max(1, Math.ceil((returnMs - departureMs) / (24 * 60 * 60 * 1000)));
      const extraDays = Math.max(0, expedition.extra_days_available ?? 0);
      const reserveDays = baseDays + extraDays;

      const perResourceAmount =
        Math.round(participantCount * rationPerPerson * reserveDays * 100) / 100;

      if (!Number.isFinite(perResourceAmount) || perResourceAmount <= 0) {
        await queryRunner.rollbackTransaction();
        return false;
      }

      for (const resource of resourceRows) {
        await queryRunner.query(
          `
          INSERT INTO camp_inventory (camp_id, resource_type_id, current_amount, minimum_alert_amount, last_update)
          VALUES ($1, $2, $3, '0.00', $4)
          ON CONFLICT (camp_id, resource_type_id)
          DO UPDATE SET
            current_amount = (camp_inventory.current_amount::numeric + EXCLUDED.current_amount::numeric)::numeric(12,2),
            last_update = EXCLUDED.last_update
          `,
          [expedition.camp_id, resource.id, (-perResourceAmount).toFixed(2), now.toISOString()],
        );

        await queryRunner.query(
          `
          INSERT INTO inventory_movement (
            camp_id,
            resource_type_id,
            amount,
            movement_type,
            source_id,
            source_type,
            recorded_by,
            date,
            description
          )
          VALUES ($1, $2, $3, 'EXPEDITION_DEPARTURE', $4, 'expedition_departure_auto', $5, $6, $7)
          `,
          [
            expedition.camp_id,
            resource.id,
            (-perResourceAmount).toFixed(2),
            expeditionId,
            recorderId,
            now.toISOString(),
            `Automatic ration provisioning for expedition departure (participants=${participantCount}, reserveDays=${reserveDays})`,
          ],
        );
      }

      await queryRunner.commitTransaction();
      return true;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async hasExpeditionCompleteNotificationPending(
    expeditionId: number,
    campId: number,
  ): Promise<boolean> {
    const rows = (await this.dataSource.query(
      `
      SELECT COUNT(*)::int AS total
      FROM notification
      WHERE camp_id = $1
        AND source_type = 'expedition_complete_pending'
        AND source_id = $2
        AND read = false
      `,
      [campId, expeditionId],
    )) as Array<{ total: number }>;

    return (rows[0]?.total ?? 0) > 0;
  }

  async markExpeditionCompleteNotificationsAsRead(
    expeditionId: number,
    campId: number,
  ): Promise<void> {
    await this.dataSource.query(
      `
      UPDATE notification
      SET read = true,
          read_date = NOW()
      WHERE camp_id = $1
        AND source_type = 'expedition_complete_pending'
        AND source_id = $2
        AND read = false
      `,
      [campId, expeditionId],
    );
  }

  async getResourceSummaryByExpeditionId(expeditionId: number): Promise<{
    consumed: Array<{
      resourceTypeId: number;
      resourceTypeName: string;
      unit: string;
      amount: string;
    }>;
    obtained: Array<{
      resourceTypeId: number;
      resourceTypeName: string;
      unit: string;
      amount: string;
    }>;
  }> {
    const consumedRows = (await this.dataSource.query(
      `
      SELECT
        erc.resource_type_id AS "resourceTypeId",
        rt.name AS "resourceTypeName",
        rt.unit_of_measure AS "unit",
        erc.amount::text AS "amount"
      FROM expedition_resource_consumed erc
      INNER JOIN resource_type rt ON rt.id = erc.resource_type_id
      WHERE erc.expedition_id = $1
      ORDER BY rt.name ASC
      `,
      [expeditionId],
    )) as Array<{
      resourceTypeId: number;
      resourceTypeName: string;
      unit: string;
      amount: string;
    }>;

    const obtainedRows = (await this.dataSource.query(
      `
      SELECT
        ero.resource_type_id AS "resourceTypeId",
        rt.name AS "resourceTypeName",
        rt.unit_of_measure AS "unit",
        ero.amount::text AS "amount"
      FROM expedition_resource_obtained ero
      INNER JOIN resource_type rt ON rt.id = ero.resource_type_id
      WHERE ero.expedition_id = $1
      ORDER BY rt.name ASC
      `,
      [expeditionId],
    )) as Array<{
      resourceTypeId: number;
      resourceTypeName: string;
      unit: string;
      amount: string;
    }>;

    return {
      consumed: consumedRows,
      obtained: obtainedRows,
    };
  }
}
