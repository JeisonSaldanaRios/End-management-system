import { Injectable, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { assertEntityExists } from '../../common/validation/assert-exists';
import { NotificationService } from '../notification/notification.service';
import { OccupationCoverageService } from '../occupationCoverage/occupationCoverage.service';
import { OccupationEntity } from '../occupation/occupation.entity';
import { PersonEntity } from '../person/person.entity';
import { UserEntity } from '../systemUser/systemUser.entity';

import { TemporaryOccupationAssignmentRepository } from './temporaryOccupationAssignment.repository';
import type {
  CreateTemporaryOccupationAssignmentDTO,
  TemporaryOccupationAssignment,
  UpdateTemporaryOccupationAssignmentDTO,
} from './temporaryOccupationAssignment.model';

@Injectable()
export class TemporaryOccupationAssignmentService {
  constructor(
    private readonly repository: TemporaryOccupationAssignmentRepository,
    private readonly dataSource: DataSource,
    private readonly notificationService: NotificationService,
    private readonly coverageService: OccupationCoverageService,
  ) {}

  private async notifyAssignmentChange(
    personId: number,
    temporaryOccupationId: number,
    sourceId: number,
    messagePrefix: string,
  ): Promise<void> {
    const person = await this.repository.findPersonById(personId);
    const occupation = await this.repository.findOccupationById(temporaryOccupationId);
    if (!person || !occupation) {
      return;
    }

    // Obtener datos del administrador y de la asignación para el correo
    const assignment = await this.repository.findById(sourceId);
    const adminPerson = assignment ? await this.repository.findAdminPersonByUserId(assignment.assignedBy) : null;
    const adminName = adminPerson ? `${adminPerson.name} ${adminPerson.lastName1}`.trim() : 'Administrador';
    const reason = assignment?.reason || 'No especificado';
    const startDate = assignment?.startDate ? new Date(assignment.startDate).toLocaleDateString() : 'Inmediata';
    const endDate = assignment?.endDate ? new Date(assignment.endDate).toLocaleDateString() : 'Indefinida';

    const fullName = `${person.name} ${person.lastName1}`.trim();
    const message = `${messagePrefix}: ${fullName} -> ${occupation.name}.`;

    await this.notificationService.notifyCampRoles(person.campId, ['SYSTEM_ADMIN'], {
      type: 'TEMPORARY_OCCUPATION_ASSIGNED',
      title: 'Asignación temporal de ocupación',
      message: `Se registró una asignación temporal: ${fullName} -> ${occupation.name}.`,
      sourceType: 'temporary_occupation_assignment',
      sourceId,
      email: {
        payload: {
          motivo: reason,
          asignadoPor: adminName,
          personaAsignada: fullName,
          fechaInicio: startDate,
          fechaFin: endDate,
        },
      },
    });

    const linkedUser = await this.repository.findActiveLinkedUserByPersonAndCamp(
      person.id,
      person.campId,
    );

    if (!linkedUser) {
      return;
    }

    await this.notificationService.notifyUser(linkedUser.id, {
      campId: person.campId,
      type: 'TEMPORARY_OCCUPATION_ASSIGNED',
      title: 'Nueva ocupación temporal',
      message: `Se te asignó temporalmente la ocupación ${occupation.name}.`,
      sourceType: 'temporary_occupation_assignment',
      sourceId,
      email: {
        payload: {
          motivo: reason,
          asignadoPor: adminName,
          fechaInicio: startDate,
          fechaFin: endDate,
        },
      },
    });
  }

  async createAssignment(
    data: CreateTemporaryOccupationAssignmentDTO,
  ): Promise<TemporaryOccupationAssignment> {
    const person = await this.dataSource.getRepository(PersonEntity).findOne({
      where: { id: data.personId },
    });
    if (!person) {
      throw new BadRequestException(`Person with ID ${data.personId} not found`);
    }

    const unavailableStatuses = ['SICK', 'INJURED', 'OUTSIDE_CAMP', 'ON_EXPEDITION'];
    if (unavailableStatuses.includes(person.currentStatus)) {
      throw new BadRequestException(
        `Person is in '${person.currentStatus}' status and cannot be temporarily reassigned.`,
      );
    }

    await assertEntityExists(
      this.dataSource,
      OccupationEntity,
      data.temporaryOccupationId,
      'Occupation',
    );
    await assertEntityExists(this.dataSource, UserEntity, data.assignedBy, 'User');

    if (person.occupationId) {
      const sourceCoverage = await this.coverageService.getCoverageById(
        person.occupationId,
        person.campId,
      );

      if (sourceCoverage) {
        const remainingAvailable = sourceCoverage.availableWorkers - 1;
        if (remainingAvailable < sourceCoverage.minimumRequiredWorkers) {
          throw new BadRequestException(
            `Cannot reassign ${person.name} from '${sourceCoverage.occupationName}' as it would leave that occupation below minimum coverage.`,
          );
        }
      }
    }

    const created = await this.repository.create(data);
    await this.notifyAssignmentChange(
      created.personId,
      created.temporaryOccupationId,
      created.id,
      'Se registro una asignacion temporal',
    );
    return created;
  }

  async getAssignmentById(id: number): Promise<TemporaryOccupationAssignment | null> {
    return await this.repository.findById(id);
  }

  async getAllAssignments(filters?: {
    personId?: number;
    temporaryOccupationId?: number;
    assignedBy?: number;
    page?: number;
    limit?: number;
  }): Promise<{ data: TemporaryOccupationAssignment[]; total: number }> {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 10;
    const offset = (page - 1) * limit;

    const repoFilters: {
      personId?: number;
      temporaryOccupationId?: number;
      assignedBy?: number;
      offset: number;
      limit: number;
    } = {
      offset,
      limit,
    };

    if (filters?.personId !== undefined) repoFilters.personId = filters.personId;
    if (filters?.temporaryOccupationId !== undefined) {
      repoFilters.temporaryOccupationId = filters.temporaryOccupationId;
    }
    if (filters?.assignedBy !== undefined) repoFilters.assignedBy = filters.assignedBy;

    return await this.repository.findAllAndCount(repoFilters);
  }

  async updateAssignment(
    id: number,
    data: UpdateTemporaryOccupationAssignmentDTO,
  ): Promise<TemporaryOccupationAssignment | null> {
    if (data.personId !== undefined) {
      await assertEntityExists(this.dataSource, PersonEntity, data.personId, 'Person');
    }
    if (data.temporaryOccupationId !== undefined) {
      await assertEntityExists(
        this.dataSource,
        OccupationEntity,
        data.temporaryOccupationId,
        'Occupation',
      );
    }
    if (data.assignedBy !== undefined) {
      await assertEntityExists(this.dataSource, UserEntity, data.assignedBy, 'User');
    }

    const updated = await this.repository.update(id, data);
    if (!updated) {
      return null;
    }

    await this.notifyAssignmentChange(
      updated.personId,
      updated.temporaryOccupationId,
      updated.id,
      'Se actualizo una asignacion temporal',
    );

    return updated;
  }

  async deleteAssignment(id: number, revocationReason?: string): Promise<boolean> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      return false;
    }

    const deleted = await this.repository.delete(id);
    if (!deleted) {
      return false;
    }

    const person = await this.repository.findPersonById(existing.personId);
    const occupation = await this.repository.findOccupationById(existing.temporaryOccupationId);
    const adminPerson = await this.repository.findAdminPersonByUserId(existing.assignedBy);
    const adminName = adminPerson
      ? `${adminPerson.name} ${adminPerson.lastName1}`.trim()
      : 'Administrador';

    const finalReason = revocationReason || existing.reason;

    if (person && occupation) {
      const linkedUser = await this.repository.findActiveLinkedUserByPersonAndCamp(
        person.id,
        person.campId,
      );

      if (linkedUser) {
        await this.notificationService.notifyUser(linkedUser.id, {
          campId: person.campId,
          type: 'TEMPORARY_OCCUPATION_REVOKED',
          title: 'Ocupación temporal revocada',
          message: `Se ha revocado tu asignación temporal como ${occupation.name}.`,
          sourceType: 'temporary_occupation_assignment',
          sourceId: existing.id,
          email: {
            payload: {
              motivo: finalReason,
              revocadoPor: adminName,
            },
          },
        });
      }

      await this.notificationService.notifyCampRoles(person.campId, ['SYSTEM_ADMIN'], {
        type: 'TEMPORARY_OCCUPATION_REVOKED',
        title: 'Asignación temporal revocada',
        message: `Se eliminó la asignación de ${person.name} como ${occupation.name}.`,
        sourceType: 'temporary_occupation_assignment',
        sourceId: existing.id,
        email: {
          payload: {
            motivo: finalReason,
            revocadoPor: adminName,
          },
        },
      });
    }

    return true;
  }
}
