import { ForbiddenException } from '@nestjs/common';
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

    it('rejects manual creation because loot is generated automatically', async () => {
      await expect(service.createRecord(validDto)).rejects.toThrow(ForbiddenException);
      await expect(service.createRecord(validDto)).rejects.toThrow(
        'Expedition loot is generated automatically when the expedition is completed',
      );
      expect(repository.create).not.toHaveBeenCalled();
      expect(notificationService.notifyCampRoles).not.toHaveBeenCalled();
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
    it('rejects manual updates because loot is generated automatically', async () => {
      await expect(service.updateRecord(1, {})).rejects.toThrow(ForbiddenException);
      await expect(service.updateRecord(1, {})).rejects.toThrow(
        'Expedition loot records cannot be updated manually because loot is generated automatically',
      );
      expect(repository.update).not.toHaveBeenCalled();
      expect(notificationService.notifyCampRoles).not.toHaveBeenCalled();
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
