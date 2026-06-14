import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PersonController } from './person.controller';
import type { PersonService } from './person.service';
import type { Request } from 'express';

describe('PersonController', () => {
  let controller: PersonController;
  let service: jest.Mocked<PersonService>;

  const mockRequest = {
    user: {
      userId: 1,
      campId: 1,
      rol: 'SYSTEM_ADMIN',
    },
  } as unknown as Request;

  beforeEach(() => {
    service = {
      createPerson: jest.fn(),
      getPersonWithSignedUrl: jest.fn(),
      getPersonById: jest.fn(),
      getAllPersonsWithSignedUrls: jest.fn(),
      updatePerson: jest.fn(),
      uploadPersonPhoto: jest.fn(),
      findUserByPersonId: jest.fn(),
      deletePerson: jest.fn(),
    } as any;
    controller = new PersonController(service);
  });

  describe('create', () => {
    it('should create a person', async () => {
      const dto = { name: 'John Doe' } as any;
      service.createPerson.mockResolvedValue({ id: 1, ...dto } as any);

      const result = await controller.create(dto);

      expect(result.success).toBe(true);
      expect(result.data.id).toBe(1);
      expect(service.createPerson).toHaveBeenCalledWith(dto);
    });

    it('should throw BadRequestException on error', async () => {
      service.createPerson.mockRejectedValue(new Error('error'));
      await expect(controller.create({} as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getById', () => {
    it('should return a person if authorized', async () => {
      service.getPersonWithSignedUrl.mockResolvedValue({ id: 1, campId: 1 } as any);

      const result = await controller.getById('1', mockRequest);

      expect(result.success).toBe(true);
      expect(result.data.id).toBe(1);
    });

    it('should throw BadRequestException if camp mismatch', async () => {
      service.getPersonWithSignedUrl.mockResolvedValue({ id: 1, campId: 2 } as any);
      await expect(controller.getById('1', mockRequest)).rejects.toThrow(
        'You do not have permission to view this person',
      );
    });

    it('should throw NotFoundException if not found', async () => {
      service.getPersonWithSignedUrl.mockResolvedValue(null);
      await expect(controller.getById('1', mockRequest)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getAll', () => {
    it('should return paginated results', async () => {
      service.getAllPersonsWithSignedUrls.mockResolvedValue({ data: [], total: 0 });

      const result = await controller.getAll(
        undefined,
        undefined,
        undefined,
        '1',
        '10',
        mockRequest,
      );

      expect(result.success).toBe(true);
      expect(result.pagination.total).toBe(0);
    });

    it('should throw BadRequestException if campId mismatch', async () => {
      await expect(
        controller.getAll('2', undefined, undefined, undefined, undefined, mockRequest),
      ).rejects.toThrow('You cannot query persons from another camp');
    });
  });

  describe('update', () => {
    it('should update a person if camp matches', async () => {
      service.getPersonById.mockResolvedValue({ id: 1, campId: 1 } as any);
      service.updatePerson.mockResolvedValue({ id: 1, name: 'Updated' } as any);

      const result = await controller.update('1', { name: 'Updated' } as any, mockRequest);

      expect(result.success).toBe(true);
      expect(result.data.name).toBe('Updated');
    });

    it('should throw BadRequestException if camp mismatch', async () => {
      service.getPersonById.mockResolvedValue({ id: 1, campId: 2 } as any);
      await expect(
        controller.update('1', { name: 'Updated' } as any, mockRequest),
      ).rejects.toThrow('You do not have permission to update this person');
    });

    it('should throw NotFoundException if person not found', async () => {
      service.getPersonById.mockResolvedValue(null);
      await expect(
        controller.update('1', { name: 'Updated' } as any, mockRequest),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('uploadPhoto', () => {
    it('should upload a photo', async () => {
      const mockFile = { mimetype: 'image/jpeg', size: 100 } as any;
      service.getPersonById.mockResolvedValue({ id: 1, campId: 1 } as any);
      service.findUserByPersonId.mockResolvedValue({ id: 1 } as any);
      service.uploadPersonPhoto.mockResolvedValue({ id: 1, photoUrl: 'url' } as any);

      const result = await controller.uploadPhoto('1', mockFile, mockRequest);

      expect(result.success).toBe(true);
      expect(result.data.photoUrl).toBe('url');
    });

    it('should throw BadRequestException for invalid mimetype', async () => {
      const mockFile = { mimetype: 'application/pdf', size: 100 } as any;
      await expect(controller.uploadPhoto('1', mockFile, mockRequest)).rejects.toThrow(
        'Invalid file type',
      );
    });
  });

  describe('getCurrentUser validations', () => {
    it('should throw BadRequestException if user context is missing or invalid', async () => {
      service.getPersonWithSignedUrl.mockResolvedValue({ id: 1, campId: 1 } as any);
      const invalidRequests = [
        {} as Request,
        { user: null } as unknown as Request,
        { user: {} } as unknown as Request,
        { user: { userId: 'not-a-number' } } as unknown as Request,
        { user: { userId: 0 } } as unknown as Request,
        { user: { userId: 1, campId: 0 } } as unknown as Request,
        { user: { userId: 1, campId: 1, rol: '' } } as unknown as Request,
      ];

      for (const req of invalidRequests) {
        await expect(controller.getById('1', req)).rejects.toThrow(
          'Authenticated user context is invalid',
        );
      }
    });
  });

  describe('getById validation and errors', () => {
    it('should throw BadRequestException if id is missing or NaN', async () => {
      await expect(controller.getById('', mockRequest)).rejects.toThrow('Invalid ID');
      await expect(controller.getById('abc', mockRequest)).rejects.toThrow('Invalid ID');
    });
  });

  describe('getAll validations', () => {
    it('should throw BadRequestException if request context is missing', async () => {
      await expect(controller.getAll(undefined, undefined, undefined, undefined, undefined, undefined)).rejects.toThrow(
        'Request context is required',
      );
    });

    it('should throw BadRequestException if campId is NaN', async () => {
      await expect(controller.getAll('abc', undefined, undefined, undefined, undefined, mockRequest)).rejects.toThrow(
        'Invalid camp ID',
      );
    });

    it('should throw BadRequestException if occupationId is NaN', async () => {
      await expect(controller.getAll(undefined, undefined, 'abc', undefined, undefined, mockRequest)).rejects.toThrow(
        'Invalid occupation ID',
      );
    });

    it('should throw BadRequestException if page is invalid', async () => {
      await expect(controller.getAll(undefined, undefined, undefined, 'abc', undefined, mockRequest)).rejects.toThrow(
        'Invalid page',
      );
      await expect(controller.getAll(undefined, undefined, undefined, '0', undefined, mockRequest)).rejects.toThrow(
        'Invalid page',
      );
    });

    it('should throw BadRequestException if limit is invalid', async () => {
      await expect(controller.getAll(undefined, undefined, undefined, undefined, 'abc', mockRequest)).rejects.toThrow(
        'Invalid limit',
      );
      await expect(controller.getAll(undefined, undefined, undefined, undefined, '0', mockRequest)).rejects.toThrow(
        'Invalid limit',
      );
    });

    it('should run successfully with valid query parameters', async () => {
      service.getAllPersonsWithSignedUrls.mockResolvedValue({ data: [], total: 0 });
      const result = await controller.getAll('1', 'ACTIVE' as any, '2', '2', '5', mockRequest);
      expect(result.success).toBe(true);
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(5);
    });
  });

  describe('update validation and exceptions', () => {
    it('should throw BadRequestException if id is missing or NaN', async () => {
      await expect(controller.update('', {}, mockRequest)).rejects.toThrow('Invalid ID');
      await expect(controller.update('abc', {}, mockRequest)).rejects.toThrow('Invalid ID');
    });

    it('should rethrow HttpException when error has getStatus', async () => {
      service.getPersonById.mockResolvedValue({ id: 1, campId: 1 } as any);
      const httpError = new NotFoundException('Service Not Found');
      service.updatePerson.mockRejectedValue(httpError);

      await expect(controller.update('1', {}, mockRequest)).rejects.toThrow(NotFoundException);
    });

    it('should throw generic BadRequestException when updatePerson throws standard error', async () => {
      service.getPersonById.mockResolvedValue({ id: 1, campId: 1 } as any);
      service.updatePerson.mockRejectedValue(new Error('DB failure'));

      await expect(controller.update('1', {}, mockRequest)).rejects.toThrow(BadRequestException);
    });
  });

  describe('uploadPhoto validations', () => {
    it('should throw BadRequestException if id is missing or NaN', async () => {
      const mockFile = { mimetype: 'image/jpeg', size: 100 } as any;
      await expect(controller.uploadPhoto('', mockFile, mockRequest)).rejects.toThrow('Invalid ID');
      await expect(controller.uploadPhoto('abc', mockFile, mockRequest)).rejects.toThrow('Invalid ID');
    });

    it('should throw BadRequestException if file is missing', async () => {
      await expect(controller.uploadPhoto('1', undefined as any, mockRequest)).rejects.toThrow(
        'No file uploaded',
      );
    });

    it('should throw BadRequestException if file size exceeds limit', async () => {
      const largeFile = { mimetype: 'image/jpeg', size: 10 * 1024 * 1024 } as any;
      await expect(controller.uploadPhoto('1', largeFile, mockRequest)).rejects.toThrow(
        'File too large',
      );
    });

    it('should throw BadRequestException if owner constraint is violated', async () => {
      const mockFile = { mimetype: 'image/jpeg', size: 100 } as any;
      service.getPersonById.mockResolvedValue({ id: 1, campId: 1 } as any);
      service.findUserByPersonId.mockResolvedValue({ id: 999 } as any); // different user id

      await expect(controller.uploadPhoto('1', mockFile, mockRequest)).rejects.toThrow(
        'You can only update your own profile photo',
      );
    });
  });

  describe('updatePhoto', () => {
    it('should update photo successfully for the owner', async () => {
      const mockFile = { mimetype: 'image/jpeg', size: 100 } as any;
      service.getPersonById.mockResolvedValue({ id: 1, campId: 1 } as any);
      service.findUserByPersonId.mockResolvedValue({ id: 1 } as any);
      service.uploadPersonPhoto.mockResolvedValue({ id: 1, photoUrl: 'updated-url' } as any);

      const result = await controller.updatePhoto('1', mockFile, mockRequest);

      expect(result.success).toBe(true);
      expect(result.data.photoUrl).toBe('updated-url');
    });

    it('should throw BadRequestException if id is invalid', async () => {
      const mockFile = { mimetype: 'image/jpeg', size: 100 } as any;
      await expect(controller.updatePhoto('', mockFile, mockRequest)).rejects.toThrow('Invalid ID');
      await expect(controller.updatePhoto('abc', mockFile, mockRequest)).rejects.toThrow('Invalid ID');
    });

    it('should throw BadRequestException if file is missing', async () => {
      await expect(controller.updatePhoto('1', undefined as any, mockRequest)).rejects.toThrow(
        'No file uploaded',
      );
    });

    it('should throw BadRequestException if file type is invalid', async () => {
      const mockFile = { mimetype: 'text/plain', size: 100 } as any;
      await expect(controller.updatePhoto('1', mockFile, mockRequest)).rejects.toThrow(
        'Invalid file type',
      );
    });

    it('should throw BadRequestException if file is too large', async () => {
      const mockFile = { mimetype: 'image/png', size: 6 * 1024 * 1024 } as any;
      await expect(controller.updatePhoto('1', mockFile, mockRequest)).rejects.toThrow(
        'File too large',
      );
    });

    it('should throw BadRequestException if not the owner', async () => {
      const mockFile = { mimetype: 'image/png', size: 100 } as any;
      service.getPersonById.mockResolvedValue({ id: 1, campId: 1 } as any);
      service.findUserByPersonId.mockResolvedValue({ id: 999 } as any);

      await expect(controller.updatePhoto('1', mockFile, mockRequest)).rejects.toThrow(
        'You can only update your own profile photo',
      );
    });
  });

  describe('delete', () => {
    it('should delete a person if camp matches', async () => {
      service.getPersonById.mockResolvedValue({ id: 1, campId: 1 } as any);
      service.deletePerson.mockResolvedValue(true);

      const result = await controller.delete('1', mockRequest);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Person deleted successfully');
    });

    it('should throw BadRequestException if camp mismatch', async () => {
      service.getPersonById.mockResolvedValue({ id: 1, campId: 2 } as any);
      await expect(controller.delete('1', mockRequest)).rejects.toThrow(
        'You do not have permission to delete this person',
      );
    });

    it('should throw NotFoundException if person not found', async () => {
      service.getPersonById.mockResolvedValue(null);
      await expect(controller.delete('1', mockRequest)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if delete fails after passing guards', async () => {
      service.getPersonById.mockResolvedValue({ id: 1, campId: 1 } as any);
      service.deletePerson.mockResolvedValue(false);
      await expect(controller.delete('1', mockRequest)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if id is missing or NaN', async () => {
      await expect(controller.delete('', mockRequest)).rejects.toThrow('Invalid ID');
      await expect(controller.delete('abc', mockRequest)).rejects.toThrow('Invalid ID');
    });

    it('should rethrow HttpException if error has getStatus', async () => {
      service.getPersonById.mockResolvedValue({ id: 1, campId: 1 } as any);
      const httpError = new NotFoundException('Not found DB');
      service.deletePerson.mockRejectedValue(httpError);
      await expect(controller.delete('1', mockRequest)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for standard error on delete', async () => {
      service.getPersonById.mockResolvedValue({ id: 1, campId: 1 } as any);
      service.deletePerson.mockRejectedValue(new Error('DB error'));
      await expect(controller.delete('1', mockRequest)).rejects.toThrow(BadRequestException);
    });
  });
});
