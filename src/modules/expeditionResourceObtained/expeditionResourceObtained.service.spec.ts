import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExpeditionResourceObtainedService } from './expeditionResourceObtained.service';
import type { ExpeditionResourceObtainedRepository } from './expeditionResourceObtained.repository';
import type { NotificationService } from '../notification/notification.service';
import type { DataSource } from 'typeorm';

jest.mock('../../common/validation/assert-exists', () => ({
  assertEntityExists: jest.fn().mockResolvedValue(true),
}));

describe('ExpeditionResourceObtainedService', () => {
  let service: ExpeditionResourceObtainedService;

  const repository = {
    findExpeditionById: jest.fn(),
    findUserById: jest.fn(),
    findMovementById: jest.fn(),
    create: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    findAllAndCount: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<ExpeditionResourceObtainedRepository>;

  const notificationService = {
    notifyCampRoles: jest.fn(),
  } as unknown as jest.Mocked<NotificationService>;

  const dataSource = {} as unknown as jest.Mocked<DataSource>;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ExpeditionResourceObtainedService(repository, dataSource, notificationService);
  });

  describe('createRecord', () => {
    const validDto = {
      expeditionId: 1,
      recordedBy: 1,
      resourceTypeId: 1,
      amount: '5.00',
      date: new Date('2026-05-01'),
    };

    it('throws if expedition not found', async () => {
      repository.findExpeditionById.mockResolvedValue(null);
      await expect(service.createRecord(validDto)).rejects.toThrow(NotFoundException);
    });

    it('throws if user not found', async () => {
      repository.findExpeditionById.mockResolvedValue({
        id: 1,
        campId: 1,
        status: 'IN_PROGRESS',
      } as never);
      repository.findUserById.mockResolvedValue(null);
      await expect(service.createRecord(validDto)).rejects.toThrow(NotFoundException);
    });

    it('throws if user is not ACTIVE', async () => {
      repository.findExpeditionById.mockResolvedValue({
        id: 1,
        campId: 1,
        status: 'IN_PROGRESS',
      } as never);
      repository.findUserById.mockResolvedValue({
        id: 1,
        status: 'INACTIVE',
        role: 'SYSTEM_ADMIN',
      } as never);
      await expect(service.createRecord(validDto)).rejects.toThrow(ForbiddenException);
    });

    it('throws if user role is not authorized', async () => {
      repository.findExpeditionById.mockResolvedValue({
        id: 1,
        campId: 1,
        status: 'IN_PROGRESS',
      } as never);
      repository.findUserById.mockResolvedValue({
        id: 1,
        status: 'ACTIVE',
        role: 'SCOUT',
      } as never);
      await expect(service.createRecord(validDto)).rejects.toThrow(ForbiddenException);
    });

    it('throws if user camp mismatches', async () => {
      repository.findExpeditionById.mockResolvedValue({
        id: 1,
        campId: 1,
        status: 'IN_PROGRESS',
      } as never);
      repository.findUserById.mockResolvedValue({
        id: 1,
        status: 'ACTIVE',
        role: 'SYSTEM_ADMIN',
        campId: 2,
      } as never);
      await expect(service.createRecord(validDto)).rejects.toThrow(BadRequestException);
    });

    it('throws if movementId is provided but not found', async () => {
      repository.findExpeditionById.mockResolvedValue({
        id: 1,
        campId: 1,
        status: 'IN_PROGRESS',
      } as never);
      repository.findUserById.mockResolvedValue({
        id: 1,
        status: 'ACTIVE',
        role: 'SYSTEM_ADMIN',
        campId: 1,
      } as never);
      repository.findMovementById.mockResolvedValue(null);
      await expect(service.createRecord({ ...validDto, movementId: 1 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws if movement camp mismatches', async () => {
      repository.findExpeditionById.mockResolvedValue({
        id: 1,
        campId: 1,
        status: 'IN_PROGRESS',
      } as never);
      repository.findUserById.mockResolvedValue({
        id: 1,
        status: 'ACTIVE',
        role: 'SYSTEM_ADMIN',
        campId: 1,
      } as never);
      repository.findMovementById.mockResolvedValue({
        id: 1,
        campId: 2,
        resourceTypeId: 1,
      } as never);
      await expect(service.createRecord({ ...validDto, movementId: 1 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws if expedition status is invalid', async () => {
      repository.findExpeditionById.mockResolvedValue({
        id: 1,
        campId: 1,
        status: 'PLANNED',
      } as never);
      repository.findUserById.mockResolvedValue({
        id: 1,
        status: 'ACTIVE',
        role: 'SYSTEM_ADMIN',
        campId: 1,
      } as never);
      await expect(service.createRecord(validDto)).rejects.toThrow(
        'No se pueden registrar recursos obtenidos',
      );
    });

    it('creates record and notifies (COMPLETED is valid)', async () => {
      repository.findExpeditionById.mockResolvedValue({
        id: 1,
        campId: 1,
        status: 'COMPLETED',
      } as never);
      repository.findUserById.mockResolvedValue({
        id: 1,
        status: 'ACTIVE',
        role: 'SYSTEM_ADMIN',
        campId: 1,
      } as never);
      repository.create.mockResolvedValue({ id: 1, ...validDto } as never);

      const result = await service.createRecord(validDto);
      expect(result.id).toBe(1);
      expect(notificationService.notifyCampRoles).toHaveBeenCalled();
    });
  });

  describe('getAllRecords', () => {
    it('fetches with pagination', async () => {
      repository.findAllAndCount.mockResolvedValue({ data: [], total: 0 });

      await service.getAllRecords({ page: 2, limit: 5 });

      expect(repository.findAllAndCount).toHaveBeenCalledWith({
        offset: 5,
        limit: 5,
      });
    });
  });

  describe('updateRecord', () => {
    it('returns null if not found', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.updateRecord(1, {})).resolves.toBeNull();
    });

    it('updates and notifies', async () => {
      repository.findById.mockResolvedValue({ id: 1, expeditionId: 1 } as never);
      repository.findExpeditionById.mockResolvedValue({
        id: 1,
        campId: 1,
        status: 'IN_PROGRESS',
      } as never);
      repository.findUserById.mockResolvedValue({
        id: 1,
        status: 'ACTIVE',
        role: 'SYSTEM_ADMIN',
        campId: 1,
      } as never);
      repository.update.mockResolvedValue({ id: 1, expeditionId: 1 } as never);

      const result = await service.updateRecord(1, {});
      expect(result?.id).toBe(1);
      expect(notificationService.notifyCampRoles).toHaveBeenCalled();
    });
  });

  describe('deleteRecord', () => {
    it('returns false if not found', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.deleteRecord(1)).resolves.toBe(false);
    });

    it('returns false if delete fails', async () => {
      repository.findById.mockResolvedValue({ id: 1, expeditionId: 1 } as never);
      repository.delete.mockResolvedValue(false);
      await expect(service.deleteRecord(1)).resolves.toBe(false);
    });

    it('deletes and notifies', async () => {
      repository.findById.mockResolvedValue({ id: 1, expeditionId: 1 } as never);
      repository.findExpeditionById.mockResolvedValue({
        id: 1,
        campId: 1,
        status: 'IN_PROGRESS',
      } as never);
      repository.delete.mockResolvedValue(true);

      await expect(service.deleteRecord(1)).resolves.toBe(true);
      expect(repository.delete).toHaveBeenCalledWith(1);
      expect(notificationService.notifyCampRoles).toHaveBeenCalled();
    });
  });
});
