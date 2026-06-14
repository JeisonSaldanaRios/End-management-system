import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PersonEntity } from '../person/person.entity';
import { NotificationService } from '../notification/notification.service';
import { ExpeditionParticipantRepository } from './expeditionParticipant.repository';
import type {
  CreateExpeditionParticipantDTO,
  ExpeditionParticipant,
  ParticipantStatus,
  UpdateExpeditionParticipantDTO,
} from './expeditionParticipant.model';

@Injectable()
export class ExpeditionParticipantService {
  constructor(
    private readonly repository: ExpeditionParticipantRepository,
    private readonly notificationService: NotificationService,
  ) {}

  async assertExpeditionCampAccess(expeditionId: number, currentCampId: number): Promise<void> {
    const campId = await this.repository.findExpeditionCampId(expeditionId);
    if (campId === null) {
      throw new NotFoundException('Expedicion no encontrada');
    }

    if (campId !== currentCampId) {
      throw new BadRequestException(
        'Solo puedes acceder a participantes de expediciones de tu campamento',
      );
    }
  }

  async assertParticipantCampAccess(id: number, currentCampId: number): Promise<void> {
    const campId = await this.repository.findParticipantCampId(id);
    if (campId === null) {
      throw new NotFoundException('Participante de expedicion no encontrado');
    }

    if (campId !== currentCampId) {
      throw new BadRequestException(
        'Solo puedes acceder a participantes de expediciones de tu campamento',
      );
    }
  }

  private isStatusManagedByExpeditions(status: PersonEntity['currentStatus']): boolean {
    return ['ACTIVE', 'ON_EXPEDITION', 'OUTSIDE_CAMP'].includes(status);
  }

  private async syncPersonStatusWithExpeditions(personId: number): Promise<void> {
    const person = await this.repository.findPersonStatusById(personId);

    if (!person) {
      return;
    }

    const hasLostExpedition = await this.repository.hasActiveParticipationInExpeditionStatuses(
      personId,
      ['LOST'],
    );
    const hasOngoingExpedition = await this.repository.hasActiveParticipationInExpeditionStatuses(
      personId,
      ['IN_PROGRESS', 'DELAYED'],
    );

    let targetStatus: PersonEntity['currentStatus'] | null = null;
    if (hasLostExpedition) {
      targetStatus = 'OUTSIDE_CAMP';
    } else if (hasOngoingExpedition) {
      targetStatus = 'ON_EXPEDITION';
    }

    if (targetStatus === null) {
      if (person.currentStatus === 'ON_EXPEDITION' || person.currentStatus === 'OUTSIDE_CAMP') {
        await this.repository.updatePersonStatus(person.id, 'ACTIVE');
      }
      return;
    }

    if (person.currentStatus === targetStatus) {
      return;
    }

    if (!this.isStatusManagedByExpeditions(person.currentStatus)) {
      return;
    }

    await this.repository.updatePersonStatus(person.id, targetStatus);
  }

  private validateCreateParticipantPreconditions(expeditionId: number, personId: number): void {
    if (!Number.isInteger(expeditionId) || expeditionId <= 0) {
      throw new BadRequestException('expeditionId debe ser un entero positivo');
    }

    if (!Number.isInteger(personId) || personId <= 0) {
      throw new BadRequestException('personId debe ser un entero positivo');
    }
  }

  private async validateParticipantCamp(
    expeditionId: number,
    personId: number,
  ): Promise<{
    expedition: NonNullable<
      Awaited<ReturnType<ExpeditionParticipantRepository['findExpeditionSummaryById']>>
    >;
    person: PersonEntity;
  }> {
    const expedition = await this.repository.findExpeditionSummaryById(expeditionId);
    if (!expedition) {
      throw new NotFoundException('Expedicion no encontrada');
    }

    if (expedition.status !== 'PLANNED') {
      throw new BadRequestException(
        'Solo las expediciones planificadas pueden recibir nuevos participantes',
      );
    }

    const person = await this.repository.findPersonById(personId);
    if (!person) {
      throw new NotFoundException('Persona no encontrada');
    }

    if (person.currentStatus === 'INACTIVE') {
      throw new BadRequestException('Las personas inactivas no pueden asignarse a expediciones');
    }

    if (person.campId !== expedition.campId) {
      throw new BadRequestException(
        'La persona no pertenece al mismo campamento que la expedicion',
      );
    }

    if (person.occupationId === null) {
      throw new BadRequestException(
        'La persona debe tener una ocupacion asignada para participar en expediciones',
      );
    }

    const occupation = await this.repository.findOccupationById(person.occupationId);
    if (!occupation) {
      throw new NotFoundException('Ocupacion no encontrada para la persona seleccionada');
    }

    if (!occupation.participatesInExpeditions) {
      throw new BadRequestException(
        `La ocupacion ${occupation.name} no esta habilitada para participar en expediciones`,
      );
    }

    const alreadyInActiveExpedition =
      await this.repository.hasActiveParticipationInExpeditionStatuses(personId, [
        'PLANNED',
        'IN_PROGRESS',
        'DELAYED',
      ]);

    if (alreadyInActiveExpedition) {
      throw new BadRequestException(
        'Esta persona ya esta asignada a una expedicion activa o planificada y no puede ser asignada a otra',
      );
    }

    return { expedition, person };
  }

  async createParticipant(data: CreateExpeditionParticipantDTO): Promise<ExpeditionParticipant> {
    this.validateCreateParticipantPreconditions(data.expeditionId, data.personId);

    const { expedition } = await this.validateParticipantCamp(data.expeditionId, data.personId);

    const existing = await this.repository.findByExpeditionAndPerson(
      data.expeditionId,
      data.personId,
    );
    if (existing) {
      throw new BadRequestException('Este participante de expedicion ya existe');
    }

    const participant = await this.repository.create(data);

    if (participant.status !== 'ACTIVE') {
      return participant;
    }

    if (expedition.status !== 'PLANNED') {
      return participant;
    }

    const assignedUser = await this.repository.findUserByPersonId(data.personId);

    if (assignedUser && assignedUser.campId === expedition.campId) {
      await this.notificationService.notifyUser(assignedUser.id, {
        campId: expedition.campId,
        type: 'EXPEDITION_RETURN',
        title: 'Asignacion de expedicion',
        message: `Has sido asignado a una nueva expedicion: ${expedition.name}. Revisa los detalles en tu panel.`,
        sourceType: 'expedition',
        sourceId: expedition.id,
      });
    }

    await this.syncPersonStatusWithExpeditions(participant.personId);

    return participant;
  }

  async getParticipantById(id: number): Promise<ExpeditionParticipant | null> {
    return await this.repository.findById(id);
  }

  async getAllParticipants(filters?: {
    expeditionId?: number;
    personId?: number;
    status?: ParticipantStatus;
    page?: number;
    limit?: number;
  }): Promise<{ data: ExpeditionParticipant[]; total: number }> {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 10;
    const offset = (page - 1) * limit;

    const repoFilters: {
      expeditionId?: number;
      personId?: number;
      status?: ParticipantStatus;
      offset: number;
      limit: number;
    } = {
      offset,
      limit,
    };

    if (filters?.expeditionId !== undefined) repoFilters.expeditionId = filters.expeditionId;
    if (filters?.personId !== undefined) repoFilters.personId = filters.personId;
    if (filters?.status !== undefined) repoFilters.status = filters.status;

    return await this.repository.findAllAndCount(repoFilters);
  }

  async updateParticipant(
    id: number,
    data: UpdateExpeditionParticipantDTO,
  ): Promise<ExpeditionParticipant | null> {
    const existing = await this.repository.findById(id);
    if (!existing) return null;

    const expeditionId = data.expeditionId ?? existing.expeditionId;
    const personId = data.personId ?? existing.personId;

    const { expedition } = await this.validateParticipantCamp(expeditionId, personId);

    const updated = await this.repository.update(id, data);
    if (!updated) {
      return null;
    }

    const linkedUser = await this.repository.findUserByPersonAndCamp(
      updated.personId,
      expedition.campId,
    );

    if (linkedUser) {
      await this.notificationService.notifyUser(linkedUser.id, {
        campId: expedition.campId,
        type: 'EXPEDITION_STATUS_UPDATED',
        title: 'Participacion en expedicion actualizada',
        message: `Tu participacion en la expedicion ${expedition.name} fue actualizada.`,
        sourceType: 'expedition_participant',
        sourceId: updated.id,
      });
    }

    if (existing.personId !== updated.personId) {
      await this.syncPersonStatusWithExpeditions(existing.personId);
    }
    await this.syncPersonStatusWithExpeditions(updated.personId);

    return updated;
  }

  async deleteParticipant(id: number): Promise<boolean> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      return false;
    }

    const deleted = await this.repository.delete(id);
    if (!deleted) {
      return false;
    }

    const expedition = await this.repository.findExpeditionSummaryById(existing.expeditionId);

    if (!expedition) {
      return true;
    }

    const linkedUser = await this.repository.findUserByPersonAndCamp(
      existing.personId,
      expedition.campId,
    );

    if (linkedUser) {
      await this.notificationService.notifyUser(linkedUser.id, {
        campId: expedition.campId,
        type: 'EXPEDITION_STATUS_UPDATED',
        title: 'Participacion en expedicion eliminada',
        message: `Fuiste removido de la expedicion ${expedition.name}.`,
        sourceType: 'expedition',
        sourceId: expedition.id,
      });
    }

    await this.syncPersonStatusWithExpeditions(existing.personId);

    return true;
  }
}
