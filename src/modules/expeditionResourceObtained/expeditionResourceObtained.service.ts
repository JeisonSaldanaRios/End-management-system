import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { assertEntityExists } from '../../common/validation/assert-exists';
import { NotificationService } from '../notification/notification.service';
import { ResourceTypeEntity } from '../resourceType/resourceType.entity';
import { ExpeditionResourceObtainedRepository } from './expeditionResourceObtained.repository';
import type {
  CreateExpeditionResourceObtainedDTO,
  ExpeditionResourceObtained,
  UpdateExpeditionResourceObtainedDTO,
} from './expeditionResourceObtained.model';

@Injectable()
export class ExpeditionResourceObtainedService {
  constructor(
    private readonly repository: ExpeditionResourceObtainedRepository,
    private readonly dataSource: DataSource,
    private readonly notificationService: NotificationService,
  ) {}

  private async validateRecorder(
    expeditionId: number,
    recordedBy: number,
    resourceTypeId: number,
    movementId?: number | null,
  ): Promise<void> {
    await assertEntityExists(this.dataSource, ResourceTypeEntity, resourceTypeId, 'Resource type');

    const expedition = await this.repository.findExpeditionById(expeditionId);
    if (!expedition) {
      throw new NotFoundException('Expedicion no encontrada');
    }

    const user = await this.repository.findUserById(recordedBy);
    if (!user) {
      throw new NotFoundException('Usuario recordedBy no encontrado');
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException(
        'Solo usuarios ACTIVE pueden registrar recursos obtenidos en expediciones',
      );
    }

    if (user.role !== 'RESOURCE_MANAGEMENT' && user.role !== 'SYSTEM_ADMIN') {
      throw new ForbiddenException(
        'Solo RESOURCE_MANAGEMENT o SYSTEM_ADMIN pueden registrar recursos obtenidos en expediciones',
      );
    }

    if (user.campId !== expedition.campId) {
      throw new BadRequestException(
        'El usuario recordedBy no pertenece al campamento de la expedicion',
      );
    }

    if (movementId === null || movementId === undefined) {
      return;
    }

    const movement = await this.repository.findMovementById(movementId);
    if (!movement) {
      throw new NotFoundException('Movimiento no encontrado');
    }

    if (movement.campId !== expedition.campId) {
      throw new BadRequestException('El movimiento no pertenece al campamento de la expedicion');
    }

    if (movement.resourceTypeId !== resourceTypeId) {
      throw new BadRequestException(
        'El tipo de recurso del movimiento no coincide con resourceTypeId',
      );
    }
  }

  async createRecord(
    data: CreateExpeditionResourceObtainedDTO,
  ): Promise<ExpeditionResourceObtained> {
    void data;
    throw new ForbiddenException(
      'Expedition loot is generated automatically when the expedition is completed',
    );
  }

  async getRecordById(id: number): Promise<ExpeditionResourceObtained | null> {
    return await this.repository.findById(id);
  }

  async getAllRecords(filters?: {
    expeditionId?: number;
    resourceTypeId?: number;
    recordedBy?: number;
    page?: number;
    limit?: number;
  }): Promise<{ data: ExpeditionResourceObtained[]; total: number }> {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 10;
    const offset = (page - 1) * limit;

    const repoFilters: {
      expeditionId?: number;
      resourceTypeId?: number;
      recordedBy?: number;
      offset: number;
      limit: number;
    } = {
      offset,
      limit,
    };

    if (filters?.expeditionId !== undefined) repoFilters.expeditionId = filters.expeditionId;
    if (filters?.resourceTypeId !== undefined) repoFilters.resourceTypeId = filters.resourceTypeId;
    if (filters?.recordedBy !== undefined) repoFilters.recordedBy = filters.recordedBy;

    return await this.repository.findAllAndCount(repoFilters);
  }

  async updateRecord(
    id: number,
    data: UpdateExpeditionResourceObtainedDTO,
  ): Promise<ExpeditionResourceObtained | null> {
    void id;
    void data;
    throw new ForbiddenException(
      'Expedition loot records cannot be updated manually because loot is generated automatically',
    );
  }

  async deleteRecord(id: number): Promise<boolean> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      return false;
    }

    const deleted = await this.repository.delete(id);
    if (!deleted) {
      return false;
    }

    const expedition = await this.repository.findExpeditionById(existing.expeditionId);
    if (expedition) {
      await this.notificationService.notifyCampRoles(
        expedition.campId,
        ['RESOURCE_MANAGEMENT', 'SYSTEM_ADMIN', 'TRAVEL_MANAGER'],
        {
          type: 'EXPEDITION_RESOURCE_OBTAINED',
          title: 'Registro de recursos obtenidos eliminado',
          message: `Se elimino un registro de recursos obtenidos de la expedicion ${existing.expeditionId}.`,
          sourceType: 'expedition_resource_obtained',
          sourceId: existing.id,
        },
      );
    }

    return true;
  }
}
