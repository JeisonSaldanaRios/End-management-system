import { BadRequestException } from '@nestjs/common';

import { UserService } from './systemUser.service';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../../common/validation/assert-exists', () => ({
  assertEntityExists: jest.fn().mockResolvedValue(undefined),
}));

// Mock bcrypt in EncryptionService to speed up tests
jest.mock('../../services/encryption.service', () => ({
  EncryptionService: {
    hashPassword: jest.fn().mockResolvedValue('hashed-password'),
    comparePassword: jest.fn(),
  },
}));

import { EncryptionService } from '../../services/encryption.service';

const userRepo = {
  create: jest.fn(),
  findAll: jest.fn(),
  findById: jest.fn(),
  findByUsername: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  countByCamp: jest.fn(),
};

const userRoleHistoryRepository = {
  create: jest.fn(),
};

const notificationService = {
  notifyUser: jest.fn().mockResolvedValue(null),
  notifyCampRoles: jest.fn().mockResolvedValue(undefined),
};

const dataSource = {};

const authRepository = {
  closeActiveSessionsByUser: jest.fn().mockResolvedValue(undefined),
};

const systemTimeService = {
  now: jest.fn().mockReturnValue(new Date('2026-01-15T10:00:00.000Z')),
};

const ACTIVE_USER = {
  id: 1,
  username: 'jperez',
  passwordHash: 'hashed',
  email: 'j@test.com',
  role: 'WORKER' as const,
  status: 'ACTIVE' as const,
  campId: 1,
  personId: 10,
  requestId: 5,
};

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    service = new UserService(
      userRepo as never,
      userRoleHistoryRepository as never,
      notificationService as never,
      dataSource as never,
      authRepository as never,
      systemTimeService as never,
    );
  });

  // ─── createUser ──────────────────────────────────────────────────────────

  describe('createUser', () => {
    it('creates user and strips passwordHash from response', async () => {
      userRepo.create.mockResolvedValue(ACTIVE_USER);

      const result = await service.createUser({
        personId: 10,
        requestId: 5,
        username: 'jperez',
        password: 'securepass123',
        email: 'j@test.com',
        role: 'WORKER',
        campId: 1,
      });

      expect(result).not.toHaveProperty('passwordHash');
      expect(result).toMatchObject({ username: 'jperez' });
      expect(EncryptionService.hashPassword).toHaveBeenCalledWith('securepass123');
    });

    it('throws when role is missing', async () => {
      await expect(
        service.createUser({
          personId: 10,
          requestId: 5,
          username: 'jperez',
          password: 'securepass123',
          email: 'j@test.com',
          campId: 1,
        } as never),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── findAllUsers ────────────────────────────────────────────────────────

  describe('findAllUsers', () => {
    it('returns all users without passwordHash', async () => {
      userRepo.findAll.mockResolvedValue([ACTIVE_USER, { ...ACTIVE_USER, id: 2 }]);

      const result = await service.findAllUsers();

      expect(result).toHaveLength(2);
      expect(result[0]).not.toHaveProperty('passwordHash');
    });
  });

  // ─── findUserById ────────────────────────────────────────────────────────

  describe('findUserById', () => {
    it('returns null when user not found', async () => {
      userRepo.findById.mockResolvedValue(null);
      expect(await service.findUserById(999)).toBeNull();
    });

    it('returns user without passwordHash when found', async () => {
      userRepo.findById.mockResolvedValue(ACTIVE_USER);
      const result = await service.findUserById(1);
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).toMatchObject({ id: 1 });
    });
  });

  describe('findUserByUsername', () => {
    it('delegates to repository with username and campId', async () => {
      userRepo.findByUsername.mockResolvedValue(ACTIVE_USER);

      await expect(service.findUserByUsername('jperez', 1)).resolves.toEqual(ACTIVE_USER);

      expect(userRepo.findByUsername).toHaveBeenCalledWith('jperez', 1);
    });
  });

  // ─── login ───────────────────────────────────────────────────────────────

  describe('login', () => {
    it('returns null when user not found', async () => {
      userRepo.findByUsername.mockResolvedValue(null);
      expect(await service.login({ username: 'none', password: 'pw', campId: 1 })).toBeNull();
    });

    it('returns null when password is wrong', async () => {
      userRepo.findByUsername.mockResolvedValue(ACTIVE_USER);
      (EncryptionService.comparePassword as jest.Mock).mockResolvedValue(false);
      expect(await service.login({ username: 'jperez', password: 'wrong', campId: 1 })).toBeNull();
    });

    it('returns user without passwordHash on valid credentials', async () => {
      userRepo.findByUsername.mockResolvedValue(ACTIVE_USER);
      (EncryptionService.comparePassword as jest.Mock).mockResolvedValue(true);

      const result = await service.login({ username: 'jperez', password: 'correct', campId: 1 });

      expect(result).not.toHaveProperty('passwordHash');
      expect(result).toMatchObject({ username: 'jperez' });
    });
  });

  // ─── updateUser ──────────────────────────────────────────────────────────

  describe('updateUser', () => {
    it('returns null when user not found', async () => {
      userRepo.findById.mockResolvedValue(null);
      expect(await service.updateUser(999, { role: 'WORKER' })).toBeNull();
    });

    it('throws when user already has the same role', async () => {
      userRepo.findById.mockResolvedValue(ACTIVE_USER);
      await expect(service.updateUser(1, { role: 'WORKER' })).rejects.toThrow(BadRequestException);
    });

    it('returns existing user without changes when nothing actually changed', async () => {
      userRepo.findById.mockResolvedValue(ACTIVE_USER);

      const result = await service.updateUser(1, { status: 'ACTIVE' });

      expect(userRepo.update).not.toHaveBeenCalled();
      expect(result).toMatchObject({ id: 1 });
    });

    it('updates role and records role history', async () => {
      userRepo.findById.mockResolvedValue(ACTIVE_USER);
      userRepo.update.mockResolvedValue({ ...ACTIVE_USER, role: 'SYSTEM_ADMIN' });
      userRoleHistoryRepository.create.mockResolvedValue(undefined);

      const result = await service.updateUser(1, { role: 'SYSTEM_ADMIN' });

      expect(userRepo.update).toHaveBeenCalledWith(1, { role: 'SYSTEM_ADMIN' });
      expect(userRoleHistoryRepository.create).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ role: 'SYSTEM_ADMIN' });
    });

    it('closes sessions when status changes to INACTIVE', async () => {
      userRepo.findById.mockResolvedValue(ACTIVE_USER);
      userRepo.update.mockResolvedValue({ ...ACTIVE_USER, status: 'INACTIVE' });

      await service.updateUser(1, { status: 'INACTIVE' });

      expect(authRepository.closeActiveSessionsByUser).toHaveBeenCalledWith(
        ACTIVE_USER.id,
        expect.any(Date),
      );
    });

    it('notifies user and camp admins when status changes', async () => {
      userRepo.findById.mockResolvedValue(ACTIVE_USER);
      userRepo.update.mockResolvedValue({ ...ACTIVE_USER, status: 'INACTIVE' });

      await service.updateUser(1, { status: 'INACTIVE' });

      expect(notificationService.notifyUser).toHaveBeenCalledWith(
        ACTIVE_USER.id,
        expect.objectContaining({ type: 'USER_STATUS_UPDATED' }),
      );
      expect(notificationService.notifyCampRoles).toHaveBeenCalledWith(
        ACTIVE_USER.campId,
        ['SYSTEM_ADMIN'],
        expect.objectContaining({ type: 'USER_STATUS_UPDATED' }),
      );
    });
  });

  // ─── deleteUser ──────────────────────────────────────────────────────────

  describe('deleteUser', () => {
    it('returns false when user not found', async () => {
      userRepo.findById.mockResolvedValue(null);
      expect(await service.deleteUser(999)).toBe(false);
    });

    it('returns false when delete fails at repository', async () => {
      userRepo.findById.mockResolvedValue(ACTIVE_USER);
      userRepo.delete.mockResolvedValue(false);
      expect(await service.deleteUser(1)).toBe(false);
    });

    it('deletes and sends notification on success', async () => {
      userRepo.findById.mockResolvedValue(ACTIVE_USER);
      userRepo.delete.mockResolvedValue(true);

      const result = await service.deleteUser(1);

      expect(result).toBe(true);
      expect(notificationService.notifyUser).toHaveBeenCalledWith(
        ACTIVE_USER.id,
        expect.objectContaining({ type: 'USER_STATUS_UPDATED', sendEmail: false }),
      );
    });
  });

  // ─── changeUserRole ──────────────────────────────────────────────────────

  describe('changeUserRole', () => {
    it('returns null when user not found', async () => {
      userRepo.findById.mockResolvedValue(null);
      expect(await service.changeUserRole(999, 'SYSTEM_ADMIN')).toBeNull();
    });

    it('throws when user already has the role', async () => {
      userRepo.findById.mockResolvedValue(ACTIVE_USER);
      await expect(service.changeUserRole(1, 'WORKER')).rejects.toThrow(BadRequestException);
    });

    it('updates role and records history', async () => {
      userRepo.findById.mockResolvedValue(ACTIVE_USER);
      userRepo.update.mockResolvedValue({ ...ACTIVE_USER, role: 'RESOURCE_MANAGEMENT' });
      userRoleHistoryRepository.create.mockResolvedValue(undefined);

      const result = await service.changeUserRole(1, 'RESOURCE_MANAGEMENT');

      expect(result).toMatchObject({ role: 'RESOURCE_MANAGEMENT' });
      expect(authRepository.closeActiveSessionsByUser).toHaveBeenCalledTimes(1);
    });

    it('returns null when repository update fails', async () => {
      userRepo.findById.mockResolvedValue(ACTIVE_USER);
      userRepo.update.mockResolvedValue(null);

      await expect(service.changeUserRole(1, 'RESOURCE_MANAGEMENT')).resolves.toBeNull();
    });
  });

  // ─── toggleUserStatus ────────────────────────────────────────────────────

  describe('toggleUserStatus', () => {
    it('returns null when user not found', async () => {
      userRepo.findById.mockResolvedValue(null);
      expect(await service.toggleUserStatus(999, 'INACTIVE')).toBeNull();
    });

    it('returns null when update fails', async () => {
      userRepo.findById.mockResolvedValue(ACTIVE_USER);
      userRepo.update.mockResolvedValue(null);
      expect(await service.toggleUserStatus(1, 'INACTIVE')).toBeNull();
    });

    it('closes sessions and notifies when status changes', async () => {
      userRepo.findById.mockResolvedValue(ACTIVE_USER);
      userRepo.update.mockResolvedValue({ ...ACTIVE_USER, status: 'INACTIVE' });

      await service.toggleUserStatus(1, 'INACTIVE');

      expect(authRepository.closeActiveSessionsByUser).toHaveBeenCalledTimes(1);
      expect(notificationService.notifyUser).toHaveBeenCalledWith(
        ACTIVE_USER.id,
        expect.objectContaining({ type: 'USER_STATUS_UPDATED' }),
      );
    });

    it('does not notify when status does not actually change', async () => {
      userRepo.findById.mockResolvedValue(ACTIVE_USER);
      userRepo.update.mockResolvedValue({ ...ACTIVE_USER, status: 'ACTIVE' }); // same status

      await service.toggleUserStatus(1, 'ACTIVE');

      expect(notificationService.notifyUser).not.toHaveBeenCalled();
    });
  });

  // ─── countUsersByCamp ────────────────────────────────────────────────────

  describe('countUsersByCamp', () => {
    it('delegates to repository', async () => {
      userRepo.countByCamp.mockResolvedValue(42);
      expect(await service.countUsersByCamp(1)).toBe(42);
    });
  });
});
