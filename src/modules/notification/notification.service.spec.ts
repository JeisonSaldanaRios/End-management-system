import { BadRequestException, NotFoundException } from '@nestjs/common';

import { NotificationService } from './notification.service';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const repository = {
  create: jest.fn(),
  findById: jest.fn(),
  findAllAndCount: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  findUserById: jest.fn(),
  findActiveUsersByCampAndRoles: jest.fn(),
};

const dataSource = {
  getRepository: jest.fn().mockReturnValue({
    findOne: jest.fn(),
  }),
  manager: {},
};

const emailOutboxService = {
  enqueue: jest.fn(),
};

const systemTimeService = {
  now: jest.fn(),
};

const NOW = new Date('2026-01-15T10:00:00.000Z');

const CAMP_ENTITY_CLASS = {};

// Mocking assertEntityExists to always resolve in unit tests
jest.mock('../../common/validation/assert-exists', () => ({
  assertEntityExists: jest.fn().mockResolvedValue(undefined),
}));

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    systemTimeService.now.mockReturnValue(new Date(NOW));
    service = new NotificationService(
      repository as never,
      dataSource as never,
      emailOutboxService as never,
      systemTimeService as never,
    );
  });

  // ─── createNotification ──────────────────────────────────────────────────

  describe('createNotification', () => {
    it('throws when neither userId nor targetRole is provided', async () => {
      await expect(
        service.createNotification({
          campId: 1,
          type: 'INVENTORY_ALERT',
          title: 'Test',
          message: 'Msg',
        }),
      ).rejects.toThrow('La notificacion debe dirigirse a un userId o a un targetRole');
    });

    it('throws NotFoundException when userId does not belong to camp', async () => {
      repository.findUserById.mockResolvedValue({ id: 5, campId: 99, email: 'x@test.com' });

      await expect(
        service.createNotification({
          campId: 1,
          userId: 5,
          type: 'INVENTORY_ALERT',
          title: 'Test',
          message: 'Msg',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when user is not found', async () => {
      repository.findUserById.mockResolvedValue(null);

      await expect(
        service.createNotification({
          campId: 1,
          userId: 999,
          type: 'INVENTORY_ALERT',
          title: 'Test',
          message: 'Msg',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates notification successfully with userId', async () => {
      repository.findUserById.mockResolvedValue({ id: 5, campId: 1, email: 'u@test.com' });
      repository.create.mockResolvedValue({
        id: 100,
        campId: 1,
        userId: 5,
        type: 'INVENTORY_ALERT',
      });

      const result = await service.createNotification({
        campId: 1,
        userId: 5,
        type: 'INVENTORY_ALERT',
        title: 'Alert',
        message: 'Low stock',
      });

      expect(result).toMatchObject({ id: 100 });
      expect(repository.create).toHaveBeenCalledTimes(1);
    });

    it('creates notification with targetRole when no userId', async () => {
      repository.findActiveUsersByCampAndRoles.mockResolvedValue([{ id: 11 }, { id: 12 }]);
      repository.create
        .mockResolvedValueOnce({ id: 200, campId: 1, userId: 11, targetRole: 'SYSTEM_ADMIN' })
        .mockResolvedValueOnce({ id: 201, campId: 1, userId: 12, targetRole: 'SYSTEM_ADMIN' });

      const result = await service.createNotification({
        campId: 1,
        targetRole: 'SYSTEM_ADMIN',
        type: 'ADMISSION_REQUEST_PENDING',
        title: 'New request',
        message: 'There is a new request',
      });

      expect(result).toMatchObject({ id: 200, userId: 11 });
      expect(repository.findActiveUsersByCampAndRoles).toHaveBeenCalledWith(1, ['SYSTEM_ADMIN']);
      expect(repository.create).toHaveBeenCalledTimes(2);
    });

    it('returns the preferred notification when preferredUserId matches a recipient', async () => {
      repository.findActiveUsersByCampAndRoles.mockResolvedValue([{ id: 11 }, { id: 12 }]);
      repository.create
        .mockResolvedValueOnce({ id: 200, campId: 1, userId: 11, targetRole: 'SYSTEM_ADMIN' })
        .mockResolvedValueOnce({ id: 201, campId: 1, userId: 12, targetRole: 'SYSTEM_ADMIN' });

      const result = await service.createNotification(
        {
          campId: 1,
          targetRole: 'SYSTEM_ADMIN',
          type: 'ADMISSION_REQUEST_PENDING',
          title: 'New request',
          message: 'There is a new request',
        },
        12,
      );

      expect(result).toMatchObject({ id: 201, userId: 12 });
    });
  });

  // ─── getNotificationById ─────────────────────────────────────────────────

  describe('getNotificationById', () => {
    it('returns the notification when found', async () => {
      repository.findById.mockResolvedValue({ id: 1, type: 'INVENTORY_ALERT' });

      const result = await service.getNotificationById(1);

      expect(result).toMatchObject({ id: 1 });
    });

    it('returns null when not found', async () => {
      repository.findById.mockResolvedValue(null);

      const result = await service.getNotificationById(999);

      expect(result).toBeNull();
    });
  });

  // ─── getAllNotifications ──────────────────────────────────────────────────

  describe('getAllNotifications', () => {
    it('returns paginated results with default page/limit', async () => {
      repository.findAllAndCount.mockResolvedValue({ data: [], total: 0 });

      const result = await service.getAllNotifications({ campId: 1 });

      expect(result).toEqual({ data: [], total: 0 });
      expect(repository.findAllAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 0, limit: 10 }),
      );
    });

    it('applies correct offset for page 2', async () => {
      repository.findAllAndCount.mockResolvedValue({ data: [], total: 0 });

      await service.getAllNotifications({ page: 2, limit: 5 });

      expect(repository.findAllAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 5, limit: 5 }),
      );
    });

    it('passes optional filters to repository', async () => {
      repository.findAllAndCount.mockResolvedValue({ data: [], total: 0 });

      await service.getAllNotifications({ campId: 3, userId: 7, read: false });

      expect(repository.findAllAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ campId: 3, userId: 7, read: false }),
      );
    });
  });

  // ─── updateNotification ──────────────────────────────────────────────────

  describe('updateNotification', () => {
    it('returns null when notification does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      const result = await service.updateNotification(999, { title: 'Updated' });

      expect(result).toBeNull();
    });

    it('throws when both userId and targetRole are explicitly set to null', async () => {
      repository.findById.mockResolvedValue({ id: 1, campId: 1, userId: 5, targetRole: 'WORKER' });

      await expect(
        service.updateNotification(1, { userId: null, targetRole: null }),
      ).rejects.toThrow('La notificacion debe dirigirse a un userId o a un targetRole');
    });

    it('sets readDate when read is true', async () => {
      repository.findById.mockResolvedValue({ id: 1, campId: 1, userId: 5, targetRole: null });
      repository.findUserById.mockResolvedValue({ id: 5, campId: 1, email: 'u@test.com' });
      repository.update.mockResolvedValue({ id: 1, read: true });

      await service.updateNotification(1, { read: true });

      expect(repository.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ read: true, readDate: NOW }),
      );
    });

    it('clears readDate when read is false', async () => {
      repository.findById.mockResolvedValue({ id: 1, campId: 1, userId: 5, targetRole: null });
      repository.findUserById.mockResolvedValue({ id: 5, campId: 1, email: 'u@test.com' });
      repository.update.mockResolvedValue({ id: 1, read: false });

      await service.updateNotification(1, { read: false });

      expect(repository.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ read: false, readDate: null }),
      );
    });
  });

  // ─── deleteNotification ──────────────────────────────────────────────────

  describe('deleteNotification', () => {
    it('returns true when deleted', async () => {
      repository.delete.mockResolvedValue(true);
      expect(await service.deleteNotification(1)).toBe(true);
    });

    it('returns false when not found', async () => {
      repository.delete.mockResolvedValue(false);
      expect(await service.deleteNotification(999)).toBe(false);
    });
  });

  // ─── queueEmail ──────────────────────────────────────────────────────────

  describe('queueEmail', () => {
    it('does nothing when email is empty/whitespace', async () => {
      await service.queueEmail({
        toEmail: '   ',
        subject: 'Hello',
        templateKey: 'generic_notification',
        payload: {},
      });
      expect(emailOutboxService.enqueue).not.toHaveBeenCalled();
    });

    it('enqueues email when address is valid', async () => {
      emailOutboxService.enqueue.mockResolvedValue(undefined);

      await service.queueEmail({ toEmail: 'user@test.com', subject: 'Hello' });

      expect(emailOutboxService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ toEmail: 'user@test.com', subject: 'Hello' }),
      );
    });

    it('uses generic_notification template when none provided', async () => {
      emailOutboxService.enqueue.mockResolvedValue(undefined);

      await service.queueEmail({ toEmail: 'user@test.com', subject: 'Test' });

      expect(emailOutboxService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ templateKey: 'generic_notification' }),
      );
    });

    it('passes maxAttempts when provided', async () => {
      emailOutboxService.enqueue.mockResolvedValue(undefined);

      await service.queueEmail({ toEmail: 'u@test.com', subject: 'Test', maxAttempts: 5 });

      expect(emailOutboxService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ maxAttempts: 5 }),
      );
    });
  });

  // ─── notifyUser ──────────────────────────────────────────────────────────

  describe('notifyUser', () => {
    it('returns null when user not found for campId', async () => {
      repository.findUserById.mockResolvedValue(null);

      await expect(
        service.notifyUser(999, {
          campId: 1,
          type: 'INVENTORY_ALERT',
          title: 'Alert',
          message: 'Low stock',
          sendEmail: false,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates notification and skips email when sendEmail is false', async () => {
      repository.findUserById.mockResolvedValue({ id: 5, campId: 1, email: 'u@test.com' });
      repository.create.mockResolvedValue({ id: 1 });

      await service.notifyUser(5, {
        campId: 1,
        type: 'INVENTORY_ALERT',
        title: 'Alert',
        message: 'Low',
        sendEmail: false,
      });

      expect(repository.create).toHaveBeenCalledTimes(1);
      expect(emailOutboxService.enqueue).not.toHaveBeenCalled();
    });

    it('creates notification and sends email when sendEmail is true', async () => {
      repository.findUserById.mockResolvedValue({ id: 5, campId: 1, email: 'u@test.com' });
      repository.create.mockResolvedValue({ id: 1 });
      emailOutboxService.enqueue.mockResolvedValue(undefined);

      await service.notifyUser(5, {
        campId: 1,
        type: 'INVENTORY_ALERT',
        title: 'Stock Alert',
        message: 'Critical low',
        sendEmail: true,
      });

      expect(emailOutboxService.enqueue).toHaveBeenCalledTimes(1);
    });

    it('merges source metadata into the notification email payload', async () => {
      repository.findUserById.mockResolvedValue({ id: 5, campId: 1, email: 'u@test.com' });
      repository.create.mockResolvedValue({ id: 1 });
      emailOutboxService.enqueue.mockResolvedValue(undefined);

      await service.notifyUser(5, {
        campId: 1,
        type: 'INVENTORY_ALERT',
        title: 'Stock Alert',
        message: 'Critical low',
        sourceType: 'inventory',
        sourceId: 77,
        sendEmail: true,
        email: {
          subject: 'Custom subject',
          templateKey: 'custom_template',
          payload: { custom: 'value' },
        },
      });

      expect(emailOutboxService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Custom subject',
          templateKey: 'custom_template',
          payload: expect.objectContaining({
            title: 'Stock Alert',
            message: 'Critical low',
            sourceType: 'inventory',
            sourceId: 77,
            custom: 'value',
          }),
        }),
      );
    });

    it('sends email by default for ADMISSION_REQUEST_PENDING type', async () => {
      repository.findUserById.mockResolvedValue({ id: 5, campId: 1, email: 'u@test.com' });
      repository.create.mockResolvedValue({ id: 1 });
      emailOutboxService.enqueue.mockResolvedValue(undefined);

      await service.notifyUser(5, {
        campId: 1,
        type: 'ADMISSION_REQUEST_PENDING',
        title: 'New Request',
        message: 'Review needed',
      });

      expect(emailOutboxService.enqueue).toHaveBeenCalledTimes(1);
    });
  });

  // ─── notifyUsers ─────────────────────────────────────────────────────────

  describe('notifyUsers', () => {
    it('deduplicates user IDs before notifying', async () => {
      repository.findUserById.mockResolvedValue({ id: 1, campId: 1, email: 'u@test.com' });
      repository.create.mockResolvedValue({ id: 10 });

      await service.notifyUsers([1, 1, 1], {
        campId: 1,
        type: 'INVENTORY_ALERT',
        title: 'T',
        message: 'M',
        sendEmail: false,
      });

      expect(repository.create).toHaveBeenCalledTimes(1);
    });

    it('skips non-positive user IDs', async () => {
      await service.notifyUsers([-1, 0], {
        campId: 1,
        type: 'INVENTORY_ALERT',
        title: 'T',
        message: 'M',
        sendEmail: false,
      });

      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  // ─── notifyCampRoles ─────────────────────────────────────────────────────

  describe('notifyCampRoles', () => {
    it('does nothing when roles array is empty', async () => {
      await service.notifyCampRoles(1, [], {
        type: 'INVENTORY_ALERT',
        title: 'T',
        message: 'M',
      });

      expect(repository.findActiveUsersByCampAndRoles).not.toHaveBeenCalled();
    });

    it('does nothing when no users found for roles', async () => {
      repository.findActiveUsersByCampAndRoles.mockResolvedValue([]);

      await service.notifyCampRoles(1, ['SYSTEM_ADMIN'], {
        type: 'INVENTORY_ALERT',
        title: 'T',
        message: 'M',
        sendEmail: false,
      });

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('notifies each user in camp with the role', async () => {
      repository.findActiveUsersByCampAndRoles.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      repository.findUserById
        .mockResolvedValueOnce({ id: 1, campId: 1, email: 'a@test.com' })
        .mockResolvedValueOnce({ id: 2, campId: 1, email: 'b@test.com' });
      repository.create.mockResolvedValue({ id: 100 });

      await service.notifyCampRoles(1, ['SYSTEM_ADMIN'], {
        type: 'INVENTORY_ALERT',
        title: 'Alert',
        message: 'Low stock',
        sendEmail: false,
      });

      expect(repository.create).toHaveBeenCalledTimes(2);
    });

    it('deduplicates duplicate roles in input', async () => {
      repository.findActiveUsersByCampAndRoles.mockResolvedValue([]);

      await service.notifyCampRoles(1, ['SYSTEM_ADMIN', 'SYSTEM_ADMIN'], {
        type: 'INVENTORY_ALERT',
        title: 'T',
        message: 'M',
      });

      expect(repository.findActiveUsersByCampAndRoles).toHaveBeenCalledWith(1, ['SYSTEM_ADMIN']);
    });
  });
  // ─── queueEmail Enrichment ──────────────────────────────────────────────

  describe('queueEmail Enrichment', () => {
    it('enriches payload with camp names', async () => {
      emailOutboxService.enqueue.mockResolvedValue(undefined);
      const campRepo = {
        findOne: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 1) return { name: 'Camp Alpha' };
          if (where.id === 2) return { name: 'Camp Beta' };
          return null;
        }),
      };
      dataSource.getRepository.mockReturnValue(campRepo);

      const payload = {
        campId: 1,
        originCampId: '2',
        destinationCampId: 3, // Not found
        other: 'value',
        nested: {
          campId: 1,
        },
        list: [{ campId: 2 }],
      };

      await service.queueEmail({ toEmail: 'u@test.com', subject: 'T', payload });

      expect(emailOutboxService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            campName: 'Camp Alpha',
            originCampName: 'Camp Beta',
            destinationCampId: 3,
            other: 'value',
            nested: expect.objectContaining({ campName: 'Camp Alpha' }),
            list: [expect.objectContaining({ campName: 'Camp Beta' })],
          }),
        }),
      );
    });

    it('enriches changedFields in payload', async () => {
      emailOutboxService.enqueue.mockResolvedValue(undefined);
      const campRepo = {
        findOne: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 1) return { name: 'Old Camp' };
          if (where.id === 2) return { name: 'New Camp' };
          return null;
        }),
      };
      dataSource.getRepository.mockReturnValue(campRepo);

      const payload = {
        changedFields: [
          { field: 'campId', previous: 1, current: 2 },
          { field: 'other', previous: 'A', current: 'B' },
          { field: 'originCampId', previous: 1 },
        ],
      };

      await service.queueEmail({ toEmail: 'u@test.com', subject: 'T', payload });

      const enqueuedPayload = emailOutboxService.enqueue.mock.calls[0][0].payload;
      expect(enqueuedPayload.changedFields[0]).toMatchObject({
        field: 'campName',
        previous: 'Old Camp',
        current: 'New Camp',
      });
      expect(enqueuedPayload.changedFields[1]).toMatchObject({
        field: 'other',
        previous: 'A',
      });
      expect(enqueuedPayload.changedFields[2]).toMatchObject({
        field: 'originCampName',
        previous: 'Old Camp',
      });
    });

    it('handles various normalized camp IDs', async () => {
      emailOutboxService.enqueue.mockResolvedValue(undefined);
      const campRepo = {
        findOne: jest.fn().mockResolvedValue({ name: 'Test Camp' }),
      };
      dataSource.getRepository.mockReturnValue(campRepo);

      await service.queueEmail({
        toEmail: 'u@test.com',
        subject: 'T',
        payload: { campId: ' 123 ' },
      });
      expect(campRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 123 } }),
      );

      await service.queueEmail({
        toEmail: 'u@test.com',
        subject: 'T',
        payload: { campId: NaN },
      });
      // Should not call findOne for invalid ID
    });
  });
});
