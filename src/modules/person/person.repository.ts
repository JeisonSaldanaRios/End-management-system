import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AdmissionRequestEntity } from '../admissionRequest/admissionRequest.entity';
import { OccupationEntity } from '../occupation/occupation.entity';
import { ExpeditionEntity } from '../expedition/expedition.entity';
import { ExpeditionParticipantEntity } from '../expeditionParticipant/expeditionParticipant.entity';
import { UserEntity } from '../systemUser/systemUser.entity';
import { PersonEntity } from './person.entity';
import type { CreatePersonDTO, Person, PersonStatus, UpdatePersonDTO } from './person.model';

@Injectable()
export class PersonRepository {
  constructor(
    @InjectRepository(PersonEntity)
    private readonly repo: Repository<PersonEntity>,
  ) {}

  async create(data: CreatePersonDTO): Promise<Person> {
    const entity = this.repo.create({
      admissionRequestId: data.admissionRequestId ?? null,
      name: data.name,
      lastName1: data.lastName1,
      lastName2: data.lastName2 ?? null,
      identificationNumber: data.identificationNumber,
      birthDate: data.birthDate,
      gender: data.gender,
      initialHealthLevel: data.initialHealthLevel ?? null,
      previousExperience: data.previousExperience ?? null,
      physicalConditionAtEntry: data.physicalConditionAtEntry ?? null,
      currentStatus: 'ACTIVE',
      imageUrl: data.imageUrl ?? null,
      campId: data.campId,
      occupationId: data.occupationId ?? null,
      character: data.character,
    });

    return await this.repo.save(entity);
  }

  async findById(id: number): Promise<Person | null> {
    return await this.repo.findOne({ where: { id } });
  }

  async findByIdentificationNumber(identificationNumber: string): Promise<Person | null> {
    return await this.repo.findOne({ where: { identificationNumber } });
  }

  async findByAdmissionRequestId(admissionRequestId: number): Promise<Person | null> {
    return await this.repo.findOne({ where: { admissionRequestId } });
  }

  async admissionRequestExists(admissionRequestId: number): Promise<boolean> {
    return await this.repo.manager.getRepository(AdmissionRequestEntity).exist({
      where: { id: admissionRequestId },
    });
  }

  async findLinkedUserByPersonAndCamp(
    personId: number,
    campId: number,
  ): Promise<Pick<UserEntity, 'id'> | null> {
    return await this.repo.manager.getRepository(UserEntity).findOne({
      where: { personId, campId },
      select: {
        id: true,
      },
    });
  }

  async findLinkedUserByPersonId(
    personId: number,
  ): Promise<Pick<UserEntity, 'id' | 'role' | 'status' | 'username'> | null> {
    return await this.repo.manager.getRepository(UserEntity).findOne({
      where: { personId },
      select: {
        id: true,
        role: true,
        status: true,
        username: true,
      },
    });
  }

  async findAllAndCount(filters?: {
    campId?: number;
    currentStatus?: PersonStatus;
    occupationId?: number;
    offset?: number;
    limit?: number;
  }): Promise<{ data: Person[]; total: number }> {
    const qb = this.repo.createQueryBuilder('p');

    if (filters?.campId !== undefined) {
      qb.andWhere('p.campId = :campId', { campId: filters.campId });
    }

    if (filters?.currentStatus !== undefined) {
      qb.andWhere('p.currentStatus = :currentStatus', {
        currentStatus: filters.currentStatus,
      });
    }

    if (filters?.occupationId !== undefined) {
      qb.andWhere('p.occupationId = :occupationId', {
        occupationId: filters.occupationId,
      });
    }

    qb.orderBy('p.createdAt', 'DESC');

    if (filters?.limit !== undefined) {
      qb.take(filters.limit);
    }

    if (filters?.offset !== undefined) {
      qb.skip(filters.offset);
    }

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async findExpeditionCandidatesAndCount(filters: {
    campId: number;
    occupationSearch?: string;
    availableOnly?: boolean;
    offset?: number;
    limit?: number;
  }): Promise<{ data: Person[]; total: number }> {
    const qb = this.repo
      .createQueryBuilder('p')
      .innerJoin(OccupationEntity, 'o', 'o.id = p.occupationId')
      .addSelect('o.name')
      .where('p.campId = :campId', { campId: filters.campId })
      .andWhere('o.participatesInExpeditions = :participatesInExpeditions', {
        participatesInExpeditions: true,
      });

    if (filters.occupationSearch?.trim()) {
      qb.andWhere('LOWER(o.name) LIKE :occupationSearch', {
        occupationSearch: `%${filters.occupationSearch.trim().toLowerCase()}%`,
      });
    }

    if (filters.availableOnly === true) {
      qb.andWhere('p.currentStatus = :currentStatus', { currentStatus: 'ACTIVE' });
      qb.andWhere(
        `
        NOT EXISTS (
          SELECT 1
          FROM ${this.repo.manager.getRepository(ExpeditionParticipantEntity).metadata.tableName} ep
          INNER JOIN ${this.repo.manager.getRepository(ExpeditionEntity).metadata.tableName} e
            ON e.id = ep.expedition_id
          WHERE ep.person_id = p.id
            AND ep.status = :activeParticipantStatus
            AND e.status IN (:...blockingExpeditionStatuses)
        )
        `,
        {
          activeParticipantStatus: 'ACTIVE',
          blockingExpeditionStatuses: ['PLANNED', 'IN_PROGRESS', 'DELAYED', 'LOST'],
        },
      );
    }

    qb.orderBy('o.name', 'ASC').addOrderBy('p.name', 'ASC').addOrderBy('p.lastName1', 'ASC');

    if (filters.limit !== undefined) {
      qb.take(filters.limit);
    }

    if (filters.offset !== undefined) {
      qb.skip(filters.offset);
    }

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async findExpeditionAssignmentsForPeople(
    personIds: number[],
  ): Promise<
    Array<{
      personId: number;
      expeditionId: number;
      expeditionName: string;
      expeditionStatus: string;
      participantStatus: string;
    }>
  > {
    if (personIds.length === 0) {
      return [];
    }

    return await this.repo.manager
      .getRepository(ExpeditionParticipantEntity)
      .createQueryBuilder('ep')
      .innerJoin(ExpeditionEntity, 'e', 'e.id = ep.expeditionId')
      .select('ep.personId', 'personId')
      .addSelect('e.id', 'expeditionId')
      .addSelect('e.name', 'expeditionName')
      .addSelect('e.status', 'expeditionStatus')
      .addSelect('ep.status', 'participantStatus')
      .where('ep.personId IN (:...personIds)', { personIds })
      .andWhere('ep.status = :participantStatus', { participantStatus: 'ACTIVE' })
      .orderBy('e.plannedDepartureDate', 'DESC')
      .getRawMany<{
        personId: number;
        expeditionId: number;
        expeditionName: string;
        expeditionStatus: string;
        participantStatus: string;
      }>();
  }

  async update(id: number, data: UpdatePersonDTO): Promise<Person | null> {
    const existing = await this.repo.findOne({ where: { id } });
    if (!existing) return null;

    const cleaned = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    ) as Partial<PersonEntity>;

    Object.assign(existing, cleaned);
    return await this.repo.save(existing);
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.repo.delete({ id });
    return (result.affected ?? 0) > 0;
  }
}
