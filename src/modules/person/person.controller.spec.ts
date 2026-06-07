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
    it('should update a person', async () => {
      service.getPersonById.mockResolvedValue({ id: 1, campId: 1 } as any);
      service.updatePerson.mockResolvedValue({ id: 1, name: 'Updated' } as any);

      const result = await controller.update('1', { name: 'Updated' } as any, mockRequest);

      expect(result.success).toBe(true);
      expect(result.data.name).toBe('Updated');
    });
  });

  describe('uploadPhoto', () => {
    it('should upload a photo', async () => {
      const mockFile = { mimetype: 'image/jpeg', size: 100 } as any;
      service.getPersonById.mockResolvedValue({ id: 1, campId: 1 } as any);
      service.findUserByPersonId.mockResolvedValue({ id: 1, campId: 1 } as any);
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

  describe('delete', () => {
    it('should delete a person', async () => {
      service.deletePerson.mockResolvedValue(true);

      const result = await controller.delete('1');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Person deleted successfully');
    });

    it('should throw BadRequestException if delete fails', async () => {
      service.deletePerson.mockResolvedValue(false);
      await expect(controller.delete('1')).rejects.toThrow(BadRequestException);
    });
  });
});
