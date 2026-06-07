import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { TransferPersonService } from './transferPerson.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('TransferPersonService (scope assertions)', () => {
  let service: TransferPersonService;

  const repository = {
    resolveTransferScope: jest.fn(),
    resolveTransferPersonScope: jest.fn(),
  } as any;

  const notificationService = { notifyCampRoles: jest.fn(), notifyUser: jest.fn() } as any;
  const transferService = { syncTransferRations: jest.fn() } as any;
  const dataSource = {} as any;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new TransferPersonService(
      repository,
      notificationService,
      transferService,
      dataSource,
    );
  });

  it('assertTransferCampAccess rejects when camp not included in scope', async () => {
    repository.resolveTransferScope.mockResolvedValue({ originCampId: 1, destinationCampId: 2 });
    await expect(service.assertTransferCampAccess(10, 3)).rejects.toThrow(
      'You can only access transfer persons involving your camp',
    );
  });

  it('assertTransferCampAccess allows origin camp access', async () => {
    repository.resolveTransferScope.mockResolvedValue({ originCampId: 1, destinationCampId: 2 });

    await expect(service.assertTransferCampAccess(10, 1)).resolves.toBeUndefined();
  });

  it('assertTransferPersonCampAccess throws NotFound when scope missing', async () => {
    repository.resolveTransferPersonScope.mockResolvedValue(null);
    await expect(service.assertTransferPersonCampAccess(99, 1)).rejects.toThrow(
      'Transfer person not found',
    );
  });

  it('assertTransferPersonCampAccess rejects when camp not in scope', async () => {
    repository.resolveTransferPersonScope.mockResolvedValue({
      originCampId: 7,
      destinationCampId: 8,
    });
    await expect(service.assertTransferPersonCampAccess(5, 3)).rejects.toThrow(
      'You can only access transfer persons involving your camp',
    );
  });

  it('assertTransferPersonCampAccess allows destination camp access', async () => {
    repository.resolveTransferPersonScope.mockResolvedValue({
      originCampId: 7,
      destinationCampId: 8,
    });

    await expect(service.assertTransferPersonCampAccess(5, 8)).resolves.toBeUndefined();
  });
});
import type { TransferPersonRepository } from './transferPerson.repository';
import type { NotificationService } from '../notification/notification.service';
import type { TransferService } from '../transfer/transfer.service';
import type { DataSource, QueryRunner } from 'typeorm';

jest.mock('../../common/validation/assert-exists', () => ({
  assertEntityExists: jest.fn(() => Promise.resolve()),
}));

describe('TransferPersonService', () => {
  let service: TransferPersonService;

  const repository = {
    findEligiblePersonIdsByCampAndOccupation: jest.fn(),
    findEligiblePersonIdsByCampAndOccupationForUpdate: jest.fn(),
    insertTransferPersonWithQueryRunner: jest.fn(),
    resolveTransferScope: jest.fn(),
    findLinkedUserByPersonId: jest.fn(),
    findByTransferAndPerson: jest.fn(),
    create: jest.fn(),
    findById: jest.fn(),
    findAllAndCount: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<TransferPersonRepository>;

  const notificationService = {
    notifyCampRoles: jest.fn(),
    notifyUser: jest.fn(),
  } as unknown as jest.Mocked<NotificationService>;

  const transferService = {
    syncTransferRations: jest.fn(),
  } as unknown as jest.Mocked<TransferService>;

  const queryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
  } as unknown as jest.Mocked<QueryRunner>;

  const dataSource = {
    createQueryRunner: jest.fn().mockReturnValue(queryRunner),
  } as unknown as jest.Mocked<DataSource>;

  beforeEach(() => {
    jest.resetAllMocks();
    dataSource.createQueryRunner.mockReturnValue(queryRunner);
    service = new TransferPersonService(
      repository,
      notificationService,
      transferService,
      dataSource,
    );
  });

  describe('canFulfillRequirements', () => {
    it('returns immediately if requirements are empty', async () => {
      await expect(service.canFulfillRequirements(1, [])).resolves.toBeUndefined();
    });

    it('throws error if requirements are invalid', async () => {
      await expect(
        service.canFulfillRequirements(1, [{ occupationId: 0, quantity: 1 }]),
      ).rejects.toThrow('occupationId must be a positive integer');
      await expect(
        service.canFulfillRequirements(1, [{ occupationId: 1, quantity: 0 }]),
      ).rejects.toThrow('quantity must be a positive integer');
    });

    it('throws error if not enough eligible people', async () => {
      repository.findEligiblePersonIdsByCampAndOccupation.mockResolvedValue([1]); // only 1 person
      await expect(
        service.canFulfillRequirements(1, [{ occupationId: 1, quantity: 2 }]),
      ).rejects.toThrow('No hay suficientes personas elegibles para el oficio 1');
    });

    it('passes if requirements can be fulfilled', async () => {
      repository.findEligiblePersonIdsByCampAndOccupation.mockResolvedValue([1, 2]);
      await expect(
        service.canFulfillRequirements(1, [{ occupationId: 1, quantity: 2 }]),
      ).resolves.toBeUndefined();
    });
  });

  describe('autoAssignGroupForTransfer', () => {
    it('returns empty array if requirements are empty', async () => {
      await expect(service.autoAssignGroupForTransfer(1, 1, [])).resolves.toEqual([]);
    });

    it('throws and rolls back if not enough eligible people', async () => {
      repository.findEligiblePersonIdsByCampAndOccupationForUpdate.mockResolvedValue([1]); // 1 person
      await expect(
        service.autoAssignGroupForTransfer(1, 1, [{ occupationId: 1, quantity: 2 }]),
      ).rejects.toThrow('No hay suficientes personas elegibles para el oficio 1');
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });

    it('assigns group successfully and syncs rations', async () => {
      repository.findEligiblePersonIdsByCampAndOccupationForUpdate.mockResolvedValue([1, 2]);
      repository.insertTransferPersonWithQueryRunner.mockResolvedValue({
        id: 10,
        personId: 1,
      } as never);

      const result = await service.autoAssignGroupForTransfer(1, 1, [
        { occupationId: 1, quantity: 1 },
      ]);

      expect(result).toHaveLength(1);
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(transferService.syncTransferRations).toHaveBeenCalledWith(1);
    });
  });

  describe('createTransferPerson', () => {
    it('throws if already assigned', async () => {
      repository.findByTransferAndPerson.mockResolvedValue({ id: 1 } as never);
      await expect(
        service.createTransferPerson({ transferId: 1, personId: 1, status: 'CONFIRMED' }),
      ).rejects.toThrow('Esta persona ya esta asignada a este traslado');
    });

    it('creates, notifies and syncs rations', async () => {
      repository.findByTransferAndPerson.mockResolvedValue(null);
      repository.create.mockResolvedValue({
        id: 1,
        transferId: 1,
        personId: 1,
        status: 'CONFIRMED',
      } as never);
      repository.resolveTransferScope.mockResolvedValue({ originCampId: 1, destinationCampId: 2 });
      repository.findLinkedUserByPersonId.mockResolvedValue({ id: 10, campId: 1 } as never);

      const result = await service.createTransferPerson({
        transferId: 1,
        personId: 1,
        status: 'CONFIRMED',
      });

      expect(result.id).toBe(1);
      expect(notificationService.notifyCampRoles).toHaveBeenCalledTimes(2);
      expect(notificationService.notifyUser).toHaveBeenCalledWith(10, expect.any(Object));
      expect(transferService.syncTransferRations).toHaveBeenCalledWith(1);
    });

    it('skips user notification when there is no linked user', async () => {
      repository.findByTransferAndPerson.mockResolvedValue(null);
      repository.create.mockResolvedValue({
        id: 1,
        transferId: 1,
        personId: 1,
        status: 'CONFIRMED',
      } as never);
      repository.resolveTransferScope.mockResolvedValue({ originCampId: 1, destinationCampId: 2 });
      repository.findLinkedUserByPersonId.mockResolvedValue(null);

      await service.createTransferPerson({
        transferId: 1,
        personId: 1,
        status: 'CONFIRMED',
      });

      expect(notificationService.notifyCampRoles).toHaveBeenCalledTimes(2);
      expect(notificationService.notifyUser).not.toHaveBeenCalled();
    });
  });

  describe('updateTransferPerson', () => {
    it('returns null if not found', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.updateTransferPerson(1, {})).resolves.toBeNull();
    });

    it('throws if trying to reassign to an existing pair', async () => {
      repository.findById.mockResolvedValue({
        id: 1,
        transferId: 1,
        personId: 1,
        status: 'CONFIRMED',
      } as never);
      repository.findByTransferAndPerson.mockResolvedValue({ id: 2 } as never); // different id

      await expect(service.updateTransferPerson(1, { personId: 2 })).rejects.toThrow(
        'Esta persona ya esta asignada a este traslado',
      );
    });

    it('updates, notifies if status changed, and syncs rations', async () => {
      repository.findById.mockResolvedValue({
        id: 1,
        transferId: 1,
        personId: 1,
        status: 'CONFIRMED',
      } as never);
      repository.update.mockResolvedValue({
        id: 1,
        transferId: 1,
        personId: 1,
        status: 'PENDING',
      } as never);
      repository.resolveTransferScope.mockResolvedValue({ originCampId: 1, destinationCampId: 2 });

      const result = await service.updateTransferPerson(1, { status: 'PENDING' } as any);

      expect(result?.status).toBe('PENDING');
      expect(notificationService.notifyCampRoles).toHaveBeenCalledTimes(2);
      expect(transferService.syncTransferRations).toHaveBeenCalledWith(1);
    });

    it('updates without sending notifications when status stays the same', async () => {
      repository.findById.mockResolvedValue({
        id: 1,
        transferId: 1,
        personId: 1,
        status: 'CONFIRMED',
      } as never);
      repository.update.mockResolvedValue({
        id: 1,
        transferId: 1,
        personId: 1,
        status: 'CONFIRMED',
      } as never);

      await expect(service.updateTransferPerson(1, { status: 'CONFIRMED' } as any)).resolves.toMatchObject({
        status: 'CONFIRMED',
      });

      expect(notificationService.notifyCampRoles).not.toHaveBeenCalled();
      expect(transferService.syncTransferRations).toHaveBeenCalledWith(1);
    });
  });

  describe('deleteTransferPerson', () => {
    it('returns false if not found', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.deleteTransferPerson(1)).resolves.toBe(false);
    });

    it('returns false if delete fails', async () => {
      repository.findById.mockResolvedValue({
        id: 1,
        transferId: 1,
        personId: 1,
        status: 'CONFIRMED',
      } as never);
      repository.delete.mockResolvedValue(false);
      await expect(service.deleteTransferPerson(1)).resolves.toBe(false);
    });

    it('deletes, notifies and syncs rations', async () => {
      repository.findById.mockResolvedValue({
        id: 1,
        transferId: 1,
        personId: 1,
        status: 'CONFIRMED',
      } as never);
      repository.delete.mockResolvedValue(true);
      repository.resolveTransferScope.mockResolvedValue({ originCampId: 1, destinationCampId: 2 });

      await expect(service.deleteTransferPerson(1)).resolves.toBe(true);

      expect(repository.delete).toHaveBeenCalledWith(1);
      expect(notificationService.notifyCampRoles).toHaveBeenCalledTimes(2);
      expect(transferService.syncTransferRations).toHaveBeenCalledWith(1);
    });
  });

  describe('getAllTransferPeople', () => {
    it('fetches with pagination', async () => {
      repository.findAllAndCount.mockResolvedValue({ data: [], total: 0 });

      await service.getAllTransferPeople({ page: 2, limit: 5 });

      expect(repository.findAllAndCount).toHaveBeenCalledWith({
        offset: 5,
        limit: 5,
      });
    });
  });
});
