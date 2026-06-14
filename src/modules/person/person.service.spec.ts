import { QueryFailedError } from 'typeorm';
import { PersonService } from './person.service';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../../common/validation/assert-exists', () => ({
  assertEntityExists: jest.fn().mockResolvedValue(undefined),
}));

const repository = {
  create: jest.fn(),
  findById: jest.fn(),
  findAllAndCount: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  admissionRequestExists: jest.fn(),
  findByIdentificationNumber: jest.fn(),
  findByAdmissionRequestId: jest.fn(),
  findLinkedUserByPersonAndCamp: jest.fn(),
  findLinkedUserByPersonId: jest.fn(),
};

const personStatusHistoryRepository = {
  create: jest.fn(),
};

const notificationService = {
  notifyUser: jest.fn(),
  notifyCampRoles: jest.fn(),
};

const occupationRepository = {
  findOne: jest.fn(),
};

const dataSource = {
  getRepository: jest.fn().mockReturnValue(occupationRepository),
  query: jest.fn(),
};

const storageService = {
  deleteImage: jest.fn(),
  uploadImage: jest.fn(),
  getSignedUrl: jest.fn(),
};

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('PersonService', () => {
  let service: PersonService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PersonService(
      repository as never,
      personStatusHistoryRepository as never,
      notificationService as never,
      dataSource as never,
      storageService as never,
    );
  });

  // ─── createPerson ──────────────────────────────────────────────────────

  describe('createPerson', () => {
    it('throws if identification number already exists', async () => {
      repository.findByIdentificationNumber.mockResolvedValue({ id: 99 });
      await expect(
        service.createPerson({ campId: 1, identificationNumber: '123' } as never),
      ).rejects.toThrow('A person with this identification number already exists');
    });

    it('throws if admission request does not exist', async () => {
      repository.findByIdentificationNumber.mockResolvedValue(null);
      repository.admissionRequestExists.mockResolvedValue(false);
      await expect(
        service.createPerson({
          campId: 1,
          identificationNumber: '123',
          admissionRequestId: 5,
        } as never),
      ).rejects.toThrow('Admission request not found');
    });

    it('throws if person for admission request already exists', async () => {
      repository.findByIdentificationNumber.mockResolvedValue(null);
      repository.admissionRequestExists.mockResolvedValue(true);
      repository.findByAdmissionRequestId.mockResolvedValue({ id: 99 });
      await expect(
        service.createPerson({
          campId: 1,
          identificationNumber: '123',
          admissionRequestId: 5,
        } as never),
      ).rejects.toThrow('A person for this admission request already exists');
    });

    it('rethrows friendly error on DB unique constraint failure', async () => {
      repository.findByIdentificationNumber.mockResolvedValue(null);

      const error = new QueryFailedError('query', [], new Error());
      (error as any).driverError = { code: '23505', constraint: 'uq_person_identification' };
      repository.create.mockRejectedValue(error);

      await expect(
        service.createPerson({ campId: 1, identificationNumber: '123' } as never),
      ).rejects.toThrow('Ya existe una persona con este numero de identificacion');
    });

    it('creates person successfully', async () => {
      repository.findByIdentificationNumber.mockResolvedValue(null);
      repository.create.mockResolvedValue({ id: 1 });

      const result = await service.createPerson({
        campId: 1,
        identificationNumber: '123',
      } as never);

      expect(repository.create).toHaveBeenCalled();
      expect(result.id).toBe(1);
    });

    it('creates person successfully with admissionRequestId', async () => {
      repository.findByIdentificationNumber.mockResolvedValue(null);
      repository.admissionRequestExists.mockResolvedValue(true);
      repository.findByAdmissionRequestId.mockResolvedValue(null);
      repository.create.mockResolvedValue({ id: 1 });

      const result = await service.createPerson({
        campId: 1,
        identificationNumber: '123',
        admissionRequestId: 5,
      } as never);

      expect(repository.create).toHaveBeenCalled();
      expect(result.id).toBe(1);
    });

    it('asserts occupation exists if provided in createPerson', async () => {
      repository.findByIdentificationNumber.mockResolvedValue(null);
      repository.create.mockResolvedValue({ id: 1 });

      await service.createPerson({
        campId: 1,
        identificationNumber: '123',
        occupationId: 5,
      } as never);

      expect(repository.create).toHaveBeenCalled();
    });
  });

  // ─── updatePerson ──────────────────────────────────────────────────────

  describe('updatePerson', () => {
    it('returns null if person not found', async () => {
      repository.findById.mockResolvedValue(null);
      expect(await service.updatePerson(1, {})).toBeNull();
    });

    it('throws if new identification belongs to another person', async () => {
      repository.findById.mockResolvedValue({ id: 1, identificationNumber: 'old' });
      repository.findByIdentificationNumber.mockResolvedValue({ id: 2 });
      await expect(service.updatePerson(1, { identificationNumber: 'new' })).rejects.toThrow(
        'Another person with this identification number already exists',
      );
    });

    it('creates history and notifies if status changes', async () => {
      repository.findById.mockResolvedValue({ id: 1, currentStatus: 'ACTIVE', campId: 1 });
      repository.update.mockResolvedValue({ id: 1, currentStatus: 'INACTIVE', campId: 1 });
      repository.findLinkedUserByPersonAndCamp.mockResolvedValue({ id: 10 });

      await service.updatePerson(1, { currentStatus: 'INACTIVE' });

      expect(personStatusHistoryRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ previousStatus: 'ACTIVE', newStatus: 'INACTIVE' }),
      );
      expect(notificationService.notifyCampRoles).toHaveBeenCalled();
      expect(notificationService.notifyUser).toHaveBeenCalledWith(10, expect.any(Object));
    });
  });

  // ─── deletePerson ──────────────────────────────────────────────────────

  describe('deletePerson', () => {
    it('returns false if not found', async () => {
      repository.findById.mockResolvedValue(null);
      expect(await service.deletePerson(1)).toBe(false);
    });

    it('deletes and notifies camp and user', async () => {
      repository.findById.mockResolvedValue({ id: 1, campId: 1 });
      repository.delete.mockResolvedValue(true);
      repository.findLinkedUserByPersonAndCamp.mockResolvedValue({ id: 10 });

      const result = await service.deletePerson(1);

      expect(result).toBe(true);
      expect(notificationService.notifyCampRoles).toHaveBeenCalled();
      expect(notificationService.notifyUser).toHaveBeenCalledWith(
        10,
        expect.objectContaining({ sendEmail: false }),
      );
    });
  });

  // ─── uploadPersonPhoto ─────────────────────────────────────────────────

  describe('uploadPersonPhoto', () => {
    it('throws if not found', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.uploadPersonPhoto(1, {} as never)).rejects.toThrow('Person not found');
    });

    it('deletes old image and uploads new', async () => {
      repository.findById.mockResolvedValue({ id: 1, imageUrl: 'old.png' });
      storageService.uploadImage.mockResolvedValue('new.png');
      repository.update.mockResolvedValue({ id: 1, imageUrl: 'new.png' });

      const result = await service.uploadPersonPhoto(1, {} as never);

      expect(storageService.deleteImage).toHaveBeenCalledWith('old.png');
      expect(storageService.uploadImage).toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(1, { imageUrl: 'new.png' });
      expect(result.imageUrl).toBe('new.png');
    });
  });

  // ─── getPersonWithSignedUrl ────────────────────────────────────────────

  describe('getPersonWithSignedUrl', () => {
    it('returns null if not found', async () => {
      repository.findById.mockResolvedValue(null);
      expect(await service.getPersonWithSignedUrl(1)).toBeNull();
    });

    it('adds signed url if imageUrl exists', async () => {
      repository.findById.mockResolvedValue({ id: 1, imageUrl: 'img.png' });
      storageService.getSignedUrl.mockResolvedValue('http://signed.url');

      const result = await service.getPersonWithSignedUrl(1);

      expect(result?.imageSignedUrl).toBe('http://signed.url');
    });

    it('handles getSignedUrl errors gracefully using rethrowFriendlyUniqueErrors', async () => {
      repository.findById.mockResolvedValue({ id: 1, imageUrl: 'img.png' });
      storageService.getSignedUrl.mockRejectedValue(new Error('S3 error'));

      const result = await service.getPersonWithSignedUrl(1);

      expect(result?.imageSignedUrl).toBeUndefined();
    });

    it('adds occupation details if occupationId exists', async () => {
      repository.findById.mockResolvedValue({ id: 1, occupationId: 5 });
      occupationRepository.findOne.mockResolvedValue({ id: 5, name: 'Soldier', description: 'Fighter' });

      const result = await service.getPersonWithSignedUrl(1);

      expect(result?.occupation).toEqual({ id: 5, name: 'Soldier', description: 'Fighter' });
      expect(dataSource.getRepository).toHaveBeenCalled();
    });

    it('handles occupation repository errors gracefully', async () => {
      repository.findById.mockResolvedValue({ id: 1, occupationId: 5 });
      occupationRepository.findOne.mockRejectedValue(new Error('DB failure'));

      const result = await service.getPersonWithSignedUrl(1);

      expect(result?.occupation).toBeNull();
    });

    it('sets userId if linkedUser exists in DB', async () => {
      repository.findById.mockResolvedValue({ id: 1 });
      repository.findLinkedUserByPersonId.mockResolvedValue({ id: 42, role: 'WORKER', status: 'ACTIVE', username: 'mockuser' });

      const result = await service.getPersonWithSignedUrl(1);

      expect(result?.userId).toBe(42);
    });

    it('sets occupation to null if occupationId exists but occupation is not found in DB', async () => {
      repository.findById.mockResolvedValue({ id: 1, occupationId: 5 });
      occupationRepository.findOne.mockResolvedValue(null);

      const result = await service.getPersonWithSignedUrl(1);

      expect(result?.occupation).toBeNull();
    });
  });

  // ─── getAllPersons ──────────────────────────────────────────────────────

  describe('getAllPersons', () => {
    it('does not apply pagination if page or limit are not provided', async () => {
      repository.findAllAndCount.mockResolvedValue({ data: [], total: 0 });
      await service.getAllPersons();
      expect(repository.findAllAndCount).toHaveBeenCalledWith({});
    });

    it('passes custom filters and pagination correctly', async () => {
      repository.findAllAndCount.mockResolvedValue({ data: [], total: 0 });
      await service.getAllPersons({
        campId: 1,
        currentStatus: 'ACTIVE' as any,
        occupationId: 2,
        page: 3,
        limit: 5,
      });
      expect(repository.findAllAndCount).toHaveBeenCalledWith({
        campId: 1,
        currentStatus: 'ACTIVE',
        occupationId: 2,
        offset: 10,
        limit: 5,
      });
    });
  });

  // ─── getAllPersonsWithSignedUrls ────────────────────────────────────────

  describe('getAllPersonsWithSignedUrls', () => {
    it('returns list of persons with signed urls', async () => {
      repository.findAllAndCount.mockResolvedValue({
        data: [{ id: 1, imageUrl: 'img.png' }],
        total: 1,
      });
      storageService.getSignedUrl.mockResolvedValue('http://signed.url');

      const result = await service.getAllPersonsWithSignedUrls();

      expect(result.total).toBe(1);
      expect(result.data[0].imageSignedUrl).toBe('http://signed.url');
    });
  });

  // ─── rethrowFriendlyUniqueErrors ───────────────────────────────────────

  describe('rethrowFriendlyUniqueErrors', () => {
    it('rethrows uq_person_request friendly error', async () => {
      repository.findByIdentificationNumber.mockResolvedValue(null);
      const error = new QueryFailedError('query', [], new Error());
      (error as any).driverError = { code: '23505', constraint: 'uq_person_request' };
      repository.create.mockRejectedValue(error);

      await expect(
        service.createPerson({ campId: 1, identificationNumber: '123' } as never),
      ).rejects.toThrow('Ya existe una persona asociada a esta solicitud de admision');
    });

    it('ignores non-QueryFailedError errors', async () => {
      repository.findByIdentificationNumber.mockResolvedValue(null);
      const error = new Error('Generic error');
      repository.create.mockRejectedValue(error);

      await expect(
        service.createPerson({ campId: 1, identificationNumber: '123' } as never),
      ).rejects.toThrow('Generic error');
    });

    it('ignores QueryFailedError with other driver error codes', async () => {
      repository.findByIdentificationNumber.mockResolvedValue(null);
      const error = new QueryFailedError('query', [], new Error());
      (error as any).driverError = { code: '23503', constraint: 'fk_camp' };
      repository.create.mockRejectedValue(error);

      await expect(
        service.createPerson({ campId: 1, identificationNumber: '123' } as never),
      ).rejects.toThrow(QueryFailedError);
    });

    it('ignores QueryFailedError with code 23505 but unknown constraint', async () => {
      repository.findByIdentificationNumber.mockResolvedValue(null);
      const error = new QueryFailedError('query', [], new Error());
      (error as any).driverError = { code: '23505', constraint: 'unknown_constraint' };
      repository.create.mockRejectedValue(error);

      await expect(
        service.createPerson({ campId: 1, identificationNumber: '123' } as never),
      ).rejects.toThrow(QueryFailedError);
    });
  });

  // ─── additional updatePerson branch tests ─────────────────────────────

  describe('updatePerson details', () => {
    it('throws if new admissionRequest belongs to another person', async () => {
      repository.findById.mockResolvedValue({ id: 1, admissionRequestId: 5 });
      repository.admissionRequestExists.mockResolvedValue(true);
      repository.findByAdmissionRequestId.mockResolvedValue({ id: 2 });

      await expect(service.updatePerson(1, { admissionRequestId: 6 })).rejects.toThrow(
        'Another person for this admission request already exists',
      );
    });

    it('throws if admissionRequest does not exist during update', async () => {
      repository.findById.mockResolvedValue({ id: 1, admissionRequestId: 5 });
      repository.admissionRequestExists.mockResolvedValue(false);

      await expect(service.updatePerson(1, { admissionRequestId: 6 })).rejects.toThrow(
        'Admission request not found',
      );
    });

    it('asserts camp and occupation exists if provided in updatePerson', async () => {
      repository.findById.mockResolvedValue({ id: 1, campId: 1, occupationId: 1 });
      repository.update.mockResolvedValue({ id: 1 });

      await service.updatePerson(1, { campId: 2, occupationId: 5 });

      expect(repository.update).toHaveBeenCalled();
    });

    it('rethrows generic error if update fails', async () => {
      repository.findById.mockResolvedValue({ id: 1 });
      const genericError = new Error('Generic database error');
      repository.update.mockRejectedValue(genericError);

      await expect(service.updatePerson(1, { name: 'New Name' })).rejects.toThrow(
        'Generic database error',
      );
    });

    it('handles status change when linkedUser is null without throwing', async () => {
      repository.findById.mockResolvedValue({ id: 1, currentStatus: 'ACTIVE', campId: 1 });
      repository.update.mockResolvedValue({ id: 1, currentStatus: 'INACTIVE', campId: 1 });
      repository.findLinkedUserByPersonAndCamp.mockResolvedValue(null);

      const result = await service.updatePerson(1, { currentStatus: 'INACTIVE' });

      expect(result?.currentStatus).toBe('INACTIVE');
      expect(personStatusHistoryRepository.create).toHaveBeenCalled();
      expect(notificationService.notifyCampRoles).toHaveBeenCalled();
      expect(notificationService.notifyUser).not.toHaveBeenCalled();
    });

    it('allows updating to own identification number', async () => {
      repository.findById.mockResolvedValue({ id: 1, identificationNumber: 'old-ident' });
      repository.findByIdentificationNumber.mockResolvedValue({ id: 1, identificationNumber: 'new-ident' });
      repository.update.mockResolvedValue({ id: 1, identificationNumber: 'new-ident' });

      const result = await service.updatePerson(1, { identificationNumber: 'new-ident' });
      expect(result?.id).toBe(1);
      expect(repository.update).toHaveBeenCalled();
    });

    it('allows updating to own admissionRequest', async () => {
      repository.findById.mockResolvedValue({ id: 1, admissionRequestId: 5 });
      repository.admissionRequestExists.mockResolvedValue(true);
      repository.findByAdmissionRequestId.mockResolvedValue({ id: 1, admissionRequestId: 6 });
      repository.update.mockResolvedValue({ id: 1, admissionRequestId: 6 });

      const result = await service.updatePerson(1, { admissionRequestId: 6 });
      expect(result?.id).toBe(1);
      expect(repository.update).toHaveBeenCalled();
    });

    it('falls back to existing.campId if updated is null during status change', async () => {
      repository.findById.mockResolvedValue({ id: 1, currentStatus: 'ACTIVE', campId: 99 });
      repository.update.mockResolvedValue(null); // returns null
      repository.findLinkedUserByPersonAndCamp.mockResolvedValue({ id: 10 });

      const result = await service.updatePerson(1, { currentStatus: 'INACTIVE' });
      expect(result).toBeNull();
      expect(notificationService.notifyCampRoles).toHaveBeenCalledWith(99, expect.any(Array), expect.any(Object));
      expect(notificationService.notifyUser).toHaveBeenCalledWith(10, expect.objectContaining({ campId: 99 }));
    });

    it('rethrows QueryFailedError from repository update', async () => {
      repository.findById.mockResolvedValue({ id: 1, identificationNumber: '123' });
      const error = new QueryFailedError('query', [], new Error());
      (error as any).driverError = { code: '23505', constraint: 'uq_person_identification' };
      repository.update.mockRejectedValue(error);

      await expect(service.updatePerson(1, { name: 'New Name' })).rejects.toThrow(
        'Ya existe una persona con este numero de identificacion',
      );
    });
  });

  // ─── additional deletePerson branch tests ─────────────────────────────

  describe('deletePerson details', () => {
    it('returns false if delete fails from repository', async () => {
      repository.findById.mockResolvedValue({ id: 1, campId: 1 });
      repository.delete.mockResolvedValue(false);

      expect(await service.deletePerson(1)).toBe(false);
    });

    it('handles delete notify when linkedUser is null without throwing', async () => {
      repository.findById.mockResolvedValue({ id: 1, campId: 1 });
      repository.delete.mockResolvedValue(true);
      repository.findLinkedUserByPersonAndCamp.mockResolvedValue(null);

      expect(await service.deletePerson(1)).toBe(true);
      expect(notificationService.notifyCampRoles).toHaveBeenCalled();
      expect(notificationService.notifyUser).not.toHaveBeenCalled();
    });
  });

  // ─── additional uploadPersonPhoto branch tests ────────────────────────

  describe('uploadPersonPhoto details', () => {
    it('throws if repository update returns null', async () => {
      repository.findById.mockResolvedValue({ id: 1 });
      storageService.uploadImage.mockResolvedValue('new.png');
      repository.update.mockResolvedValue(null);

      await expect(service.uploadPersonPhoto(1, {} as never)).rejects.toThrow('Person not found');
    });

    it('calls rethrowFriendlyUniqueErrors if deleteImage fails', async () => {
      repository.findById.mockResolvedValue({ id: 1, imageUrl: 'old.png' });
      const error = new QueryFailedError('query', [], new Error());
      (error as any).driverError = { code: '23505', constraint: 'uq_person_identification' };
      storageService.deleteImage.mockRejectedValue(error);
      storageService.uploadImage.mockResolvedValue('new.png');
      repository.update.mockResolvedValue({ id: 1, imageUrl: 'new.png' });

      await expect(service.uploadPersonPhoto(1, {} as never)).rejects.toThrow(
        'Ya existe una persona con este numero de identificacion',
      );
    });
  });
});
