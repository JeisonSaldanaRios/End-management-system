import { Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { CampEntity } from '../camp/camp.entity';
import { NotificationService } from '../notification/notification.service';
import { OccupationEntity } from '../occupation/occupation.entity';
import { assertEntityExists } from '../../common/validation/assert-exists';
import { PersonRepository } from './person.repository';
import type { CreatePersonDTO, Person, PersonStatus, UpdatePersonDTO } from './person.model';
import { PersonStatusHistoryRepository } from '../personStatusHistory/personStatusHistory.repository';
import { R2StorageService } from '../../services/r2-storage.service';
import type { UserEntity } from '../systemUser/systemUser.entity';

@Injectable()
export class PersonService {
  constructor(
    private readonly repository: PersonRepository,
    private readonly personStatusHistoryRepository: PersonStatusHistoryRepository,
    private readonly notificationService: NotificationService,
    private readonly dataSource: DataSource,
    private readonly storageService: R2StorageService,
  ) {}

  private async assertAdmissionRequestExists(admissionRequestId: number): Promise<void> {
    const exists = await this.repository.admissionRequestExists(admissionRequestId);
    if (!exists) {
      throw new Error('Admission request not found');
    }
  }

  async createPerson(data: CreatePersonDTO): Promise<Person> {
    await assertEntityExists(this.dataSource, CampEntity, data.campId, 'Camp');
    if (data.occupationId !== undefined && data.occupationId !== null) {
      await assertEntityExists(this.dataSource, OccupationEntity, data.occupationId, 'Occupation');
    }
    const existingByIdentification = await this.repository.findByIdentificationNumber(
      data.identificationNumber,
    );
    if (existingByIdentification) {
      throw new Error('A person with this identification number already exists');
    }
    const admissionRequestId = data.admissionRequestId ?? null;
    if (admissionRequestId !== null) {
      await this.assertAdmissionRequestExists(admissionRequestId);
      const existingByRequest = await this.repository.findByAdmissionRequestId(admissionRequestId);
      if (existingByRequest) {
        throw new Error('A person for this admission request already exists');
      }
    }
    try {
      return await this.repository.create(data);
    } catch (error) {
      this.rethrowFriendlyUniqueErrors(error);
      throw error;
    }
  }

  async getPersonById(id: number): Promise<Person | null> {
    return await this.repository.findById(id);
  }

  async getAllPersons(filters?: {
    campId?: number;
    currentStatus?: PersonStatus;
    occupationId?: number;
    page?: number;
    limit?: number;
  }): Promise<{ data: Person[]; total: number }> {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 10;
    const offset = (page - 1) * limit;
    const repoFilters: {
      campId?: number;
      currentStatus?: PersonStatus;
      occupationId?: number;
      offset: number;
      limit: number;
    } = {
      offset,
      limit,
    };
    if (filters?.campId !== undefined) repoFilters.campId = filters.campId;
    if (filters?.currentStatus !== undefined) repoFilters.currentStatus = filters.currentStatus;
    if (filters?.occupationId !== undefined) repoFilters.occupationId = filters.occupationId;
    return await this.repository.findAllAndCount(repoFilters);
  }

  async updatePerson(id: number, data: UpdatePersonDTO): Promise<Person | null> {
    const existing = await this.repository.findById(id);
    if (!existing) return null;
    if (data.campId !== undefined) {
      await assertEntityExists(this.dataSource, CampEntity, data.campId, 'Camp');
    }
    if (data.occupationId !== undefined && data.occupationId !== null) {
      await assertEntityExists(this.dataSource, OccupationEntity, data.occupationId, 'Occupation');
    }
    if (data.identificationNumber && data.identificationNumber !== existing.identificationNumber) {
      const byIdentification = await this.repository.findByIdentificationNumber(
        data.identificationNumber,
      );
      if (byIdentification && byIdentification.id !== id) {
        throw new Error('Another person with this identification number already exists');
      }
    }
    if (
      data.admissionRequestId !== undefined &&
      data.admissionRequestId !== existing.admissionRequestId &&
      data.admissionRequestId !== null
    ) {
      await this.assertAdmissionRequestExists(data.admissionRequestId);
      const byRequest = await this.repository.findByAdmissionRequestId(data.admissionRequestId);
      if (byRequest && byRequest.id !== id) {
        throw new Error('Another person for this admission request already exists');
      }
    }
    let updated: Person | null;

    try {
      updated = await this.repository.update(id, data);
    } catch (error) {
      this.rethrowFriendlyUniqueErrors(error);
      throw error;
    }

    if (data.currentStatus !== undefined && data.currentStatus !== existing.currentStatus) {
      await this.personStatusHistoryRepository.create({
        personId: id,
        previousStatus: existing.currentStatus,
        newStatus: data.currentStatus,
        changedBy: 0,
        reason: null,
      });

      await this.notificationService.notifyCampRoles(
        updated?.campId ?? existing.campId,
        ['SYSTEM_ADMIN', 'RESOURCE_MANAGEMENT', 'TRAVEL_MANAGER'],
        {
          type: 'PERSON_STATUS_CHANGED',
          title: 'Cambio de estado de persona',
          message: `La persona ${id} cambio de estado de ${existing.currentStatus} a ${data.currentStatus}.`,
          sourceType: 'person',
          sourceId: id,
        },
      );

      const linkedUser = await this.repository.findLinkedUserByPersonAndCamp(
        id,
        updated?.campId ?? existing.campId,
      );

      if (linkedUser) {
        await this.notificationService.notifyUser(linkedUser.id, {
          campId: updated?.campId ?? existing.campId,
          type: 'PERSON_STATUS_CHANGED',
          title: 'Cambio de estado personal',
          message: `Tu estado fue actualizado de ${existing.currentStatus} a ${data.currentStatus}.`,
          sourceType: 'person',
          sourceId: id,
        });
      }
    }
    return updated;
  }

  async deletePerson(id: number): Promise<boolean> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      return false;
    }

    const deleted = await this.repository.delete(id);
    if (!deleted) {
      return false;
    }

    await this.notificationService.notifyCampRoles(
      existing.campId,
      ['SYSTEM_ADMIN', 'RESOURCE_MANAGEMENT', 'TRAVEL_MANAGER'],
      {
        type: 'PERSON_STATUS_CHANGED',
        title: 'Persona eliminada',
        message: `La persona ${existing.id} fue eliminada del sistema.`,
        sourceType: 'person',
        sourceId: existing.id,
      },
    );

    const linkedUser = await this.repository.findLinkedUserByPersonAndCamp(
      existing.id,
      existing.campId,
    );

    if (linkedUser) {
      await this.notificationService.notifyUser(linkedUser.id, {
        campId: existing.campId,
        type: 'PERSON_STATUS_CHANGED',
        title: 'Registro personal eliminado',
        message: 'Tu registro personal fue eliminado del sistema.',
        sourceType: 'person',
        sourceId: existing.id,
        sendEmail: false,
      });
    }

    return true;
  }

  private rethrowFriendlyUniqueErrors(error: unknown): never | void {
    if (!(error instanceof QueryFailedError)) {
      return;
    }

    const driverError = error.driverError as {
      code?: string;
      constraint?: string;
    };

    if (driverError?.code !== '23505') {
      return;
    }

    if (driverError.constraint === 'uq_person_request') {
      throw new Error('Ya existe una persona asociada a esta solicitud de admision');
    }

    if (driverError.constraint === 'uq_person_identification') {
      throw new Error('Ya existe una persona con este numero de identificacion');
    }
  }

  async uploadPersonPhoto(id: number, file: Express.Multer.File): Promise<Person> {
    const existing = await this.repository.findById(id);
    if (!existing) throw new Error('Person not found');

    if (existing.imageUrl) {
      try {
        await this.storageService.deleteImage(existing.imageUrl);
      } catch (error) {
        this.rethrowFriendlyUniqueErrors(error);
      }
    }

    const filePath = await this.storageService.uploadImage(file, 'person-photos');
    const updated = await this.repository.update(id, { imageUrl: filePath });
    if (!updated) throw new Error('Person not found');
    return updated;
  }

  private async addSignedUrlToPerson(
    person: Person,
  ): Promise<Person & { imageSignedUrl?: string; userId?: number | null; occupation?: { id: number; name: string; description: string | null } | null }> {
    const result: Person & {
      imageSignedUrl?: string;
      userId?: number | null;
      occupation?: { id: number; name: string; description: string | null } | null;
    } = { ...person };

    if (person.imageUrl) {
      try {
        result.imageSignedUrl = await this.storageService.getSignedUrl(person.imageUrl);
      } catch (error) {
        this.rethrowFriendlyUniqueErrors(error);
      }
    }

    const linkedUser = await this.findUserByPersonId(person.id);
    result.userId = linkedUser ? linkedUser.id : null;

    let occupationData: { id: number; name: string; description: string | null } | null = null;
    if (person.occupationId) {
      try {
        const occupationRepo = this.dataSource.getRepository(OccupationEntity);
        const occupation = await occupationRepo.findOne({
          where: { id: person.occupationId },
          select: { id: true, name: true, description: true },
        });
        if (occupation) {
          occupationData = {
            id: occupation.id,
            name: occupation.name,
            description: occupation.description,
          };
        }
      } catch (error) {
        this.rethrowFriendlyUniqueErrors(error);
      }
    }
    result.occupation = occupationData;

    return result;
  }

  async getPersonWithSignedUrl(id: number): Promise<(Person & { imageSignedUrl?: string }) | null> {
    const person = await this.getPersonById(id);
    if (!person) return null;
    return await this.addSignedUrlToPerson(person);
  }

  async findUserByPersonId(personId: number): Promise<Pick<UserEntity, 'id'> | null> {
    return await this.repository.findLinkedUserByPersonId(personId);
  }

  async getAllPersonsWithSignedUrls(filters?: {
    campId?: number;
    currentStatus?: PersonStatus;
    occupationId?: number;
    page?: number;
    limit?: number;
  }): Promise<{ data: (Person & { imageSignedUrl?: string })[]; total: number }> {
    const result = await this.getAllPersons(filters);
    const dataWithUrls = await Promise.all(
      result.data.map((person) => this.addSignedUrlToPerson(person)),
    );
    return { data: dataWithUrls, total: result.total };
  }
}
