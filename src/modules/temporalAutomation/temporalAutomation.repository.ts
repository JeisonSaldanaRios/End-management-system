import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';

import { CampEntity } from '../camp/camp.entity';
import { CampInventoryEntity } from '../campInventory/campInventory.entity';
import { ExpeditionEntity } from '../expedition/expedition.entity';
import { InventoryAlertEntity } from '../inventoryAlert/inventoryAlert.entity';
import { OccupationEntity } from '../occupation/occupation.entity';
import { PersonEntity } from '../person/person.entity';
import { ResourceTypeEntity } from '../resourceType/resourceType.entity';
import { UserEntity } from '../systemUser/systemUser.entity';

@Injectable()
export class TemporalAutomationRepository {
  constructor(
    @InjectRepository(CampEntity)
    private readonly campRepo: Repository<CampEntity>,
    @InjectRepository(CampInventoryEntity)
    private readonly campInventoryRepo: Repository<CampInventoryEntity>,
    @InjectRepository(ExpeditionEntity)
    private readonly expeditionRepo: Repository<ExpeditionEntity>,
    @InjectRepository(InventoryAlertEntity)
    private readonly inventoryAlertRepo: Repository<InventoryAlertEntity>,
    @InjectRepository(OccupationEntity)
    private readonly occupationRepo: Repository<OccupationEntity>,
    @InjectRepository(PersonEntity)
    private readonly personRepo: Repository<PersonEntity>,
    @InjectRepository(ResourceTypeEntity)
    private readonly resourceTypeRepo: Repository<ResourceTypeEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {}

  async findDailyCycleCamps(): Promise<
    Array<Pick<CampEntity, 'id' | 'name' | 'minimumDailyRationPerPerson' | 'maxPersonCapacity'>>
  > {
    return await this.campRepo.find({
      select: ['id', 'name', 'minimumDailyRationPerPerson', 'maxPersonCapacity'],
    });
  }

  async findResourceTypeByCategory(
    category: ResourceTypeEntity['category'],
  ): Promise<ResourceTypeEntity | null> {
    return await this.resourceTypeRepo.findOne({ where: { category } });
  }

  async countCampOperationalPeople(campId: number): Promise<number> {
    return await this.personRepo.count({
      where: {
        campId,
        currentStatus: In(['ACTIVE', 'SICK', 'INJURED']),
      },
    });
  }

  async findExpeditionsForAutoStateUpdate(): Promise<ExpeditionEntity[]> {
    return await this.expeditionRepo.find({
      where: {
        status: Not(In(['COMPLETED', 'CANCELED', 'LOST', 'RETURNED_AFTER_LOST'])),
      },
    });
  }

  async getOrCreateCampInventory(
    campId: number,
    resourceTypeId: number,
  ): Promise<CampInventoryEntity> {
    const found = await this.campInventoryRepo.findOne({
      where: { campId, resourceTypeId },
    });

    if (found) {
      return found;
    }

    const created = this.campInventoryRepo.create({
      campId,
      resourceTypeId,
      currentAmount: '0.00',
      minimumAlertAmount: '0.00',
    });

    return await this.campInventoryRepo.save(created);
  }

  async findProductionOccupationRows(
    campId: number,
    nowIso: string,
  ): Promise<Array<{ occupation_id: string | number }>> {
    return (await this.personRepo.query(
      `
      SELECT
        COALESCE(ta.temporary_occupation_id, p.occupation_id) AS occupation_id
      FROM person p
      LEFT JOIN LATERAL (
        SELECT temporary_occupation_id
        FROM temporary_occupation_assignment
        WHERE person_id = p.id
          AND start_date <= $2
          AND (end_date IS NULL OR end_date >= $2)
        ORDER BY start_date DESC
        LIMIT 1
      ) ta ON true
      WHERE p.camp_id = $1
        AND p.current_status NOT IN ('SICK', 'INJURED', 'OUTSIDE_CAMP')
        AND COALESCE(ta.temporary_occupation_id, p.occupation_id) IS NOT NULL
      `,
      [campId, nowIso],
    )) as Array<{ occupation_id: string | number }>;
  }

  async findDailyCollectionRows(
    campId: number,
    nowIso: string,
  ): Promise<
    Array<{
      personId: number;
      resourceTypeId: number;
      expectedAmount: string;
    }>
  > {
    return (await this.personRepo.query(
      `
      SELECT
        p.id AS "personId",
        o.resource_type_id AS "resourceTypeId",
        o.daily_amount_produced::text AS "expectedAmount"
      FROM person p
      LEFT JOIN LATERAL (
        SELECT temporary_occupation_id
        FROM temporary_occupation_assignment
        WHERE person_id = p.id
          AND start_date <= $2
          AND (end_date IS NULL OR end_date >= $2)
        ORDER BY start_date DESC
        LIMIT 1
      ) ta ON true
      JOIN occupation o ON o.id = COALESCE(ta.temporary_occupation_id, p.occupation_id)
      WHERE p.camp_id = $1
        AND p.current_status NOT IN ('SICK', 'INJURED', 'OUTSIDE_CAMP')
        AND o.resource_type_id IS NOT NULL
        AND o.daily_amount_produced::numeric > 0
      ORDER BY p.id ASC
      `,
      [campId, nowIso],
    )) as Array<{
      personId: number;
      resourceTypeId: number;
      expectedAmount: string;
    }>;
  }

  async findProductionOccupationsByIds(
    occupationIds: number[],
  ): Promise<Array<Pick<OccupationEntity, 'id' | 'resourceTypeId' | 'dailyAmountProduced'>>> {
    if (occupationIds.length === 0) {
      return [];
    }

    return await this.occupationRepo.find({
      where: {
        id: In(occupationIds),
      },
      select: ['id', 'resourceTypeId', 'dailyAmountProduced'],
    });
  }

  async findCampInventories(
    campId: number,
    resourceTypeIds: number[],
  ): Promise<CampInventoryEntity[]> {
    if (resourceTypeIds.length === 0) {
      return [];
    }

    return await this.campInventoryRepo.find({
      where: {
        campId,
        resourceTypeId: In(resourceTypeIds),
      },
    });
  }

  async findUnresolvedInventoryAlert(
    campId: number,
    resourceTypeId: number,
  ): Promise<InventoryAlertEntity | null> {
    return await this.inventoryAlertRepo.findOne({
      where: {
        campId,
        resourceTypeId,
        resolved: false,
      },
    });
  }

  async findRelevantOccupationsForStaffing(): Promise<
    Array<Pick<OccupationEntity, 'id' | 'name'>>
  > {
    return await this.occupationRepo.find({
      where: [{ collectsResources: true }, { participatesInExpeditions: true }],
      select: {
        id: true,
        name: true,
      },
    });
  }

  async findActivePeopleOccupationIds(
    campId: number,
    occupationIds: number[],
  ): Promise<Array<{ occupationId: number | null }>> {
    if (occupationIds.length === 0) {
      return [];
    }

    return await this.personRepo.find({
      where: {
        campId,
        currentStatus: 'ACTIVE',
        occupationId: In(occupationIds),
      },
      select: {
        occupationId: true,
      },
    });
  }

  async findPersonStatusById(
    personId: number,
  ): Promise<Pick<PersonEntity, 'id' | 'currentStatus'> | null> {
    return await this.personRepo.findOne({
      where: { id: personId },
      select: {
        id: true,
        currentStatus: true,
      },
    });
  }

  async updatePersonStatus(personId: number, status: PersonEntity['currentStatus']): Promise<void> {
    await this.personRepo.update({ id: personId }, { currentStatus: status });
  }

  async findActiveUserIdsByCampAndPersonIds(
    campId: number,
    personIds: number[],
  ): Promise<number[]> {
    if (personIds.length === 0) {
      return [];
    }

    const users = await this.userRepo.find({
      where: {
        personId: In(personIds),
        campId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
      },
    });

    return users.map((user) => user.id);
  }

  async findAutomationRecorderUserId(campId: number): Promise<number | null> {
    const preferred = await this.userRepo.findOne({
      where: [
        {
          campId,
          status: 'ACTIVE',
          role: 'RESOURCE_MANAGEMENT',
        },
        {
          campId,
          status: 'ACTIVE',
          role: 'SYSTEM_ADMIN',
        },
      ],
      order: {
        id: 'ASC',
      },
      select: {
        id: true,
      },
    });

    if (preferred) {
      return preferred.id;
    }

    const fallback = await this.userRepo.findOne({
      where: {
        campId,
        status: 'ACTIVE',
      },
      order: {
        id: 'ASC',
      },
      select: {
        id: true,
      },
    });

    return fallback?.id ?? null;
  }
}
