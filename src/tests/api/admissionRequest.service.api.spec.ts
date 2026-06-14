import { CampEntity } from '../../modules/camp/camp.entity';
import { DecisionTreeService } from '../../modules/decisionTree/decisionTree.service';
import { EncryptionService } from '../../services/encryption.service';
import { PersonEntity } from '../../modules/person/person.entity';
import { OccupationEntity } from '../../modules/occupation/occupation.entity';
import { R2StorageService } from '../../services/r2-storage.service';
import { SystemTimeService } from '../../modules/systemTime/systemTime.service';
import { UserEntity } from '../../modules/systemUser/systemUser.entity';
import { AdmissionRequestService } from '../../modules/admissionRequest/admissionRequest.service';

describe('AdmissionRequestService (API-focused unit tests)', () => {
  let repository: any;
  let dataSource: any;
  let decisionTreeService: jest.Mocked<DecisionTreeService>;
  let notificationService: any;
  let systemTimeService: jest.Mocked<SystemTimeService>;
  let storageService: jest.Mocked<R2StorageService>;
  let service: AdmissionRequestService;
  let campRepository: any;
  let occupationRepository: any;
  let personRepository: any;
  let userRepository: any;

  beforeEach(() => {
    campRepository = {
      exist: jest.fn().mockResolvedValue(true),
    };
    occupationRepository = {
      exist: jest.fn().mockResolvedValue(true),
      findOne: jest.fn(),
    };
    personRepository = {
      findOne: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ ...value, id: 33 })),
    };
    userRepository = {
      findOne: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      exist: jest.fn().mockResolvedValue(true),
    };

    repository = {
      findById: jest.fn(),
      findAll: jest.fn(),
      countByCampAndStatus: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findByEmailAndCamp: jest.fn(),
      create: jest.fn(),
      saveAiAdmissionReport: jest.fn(),
      findOccupationByName: jest.fn(),
      findApprovedByEmailExcludingId: jest.fn(),
    };

    dataSource = {
      getRepository: jest.fn((entity: any) => {
        if (entity === CampEntity) return campRepository;
        if (entity === OccupationEntity) return occupationRepository;
        if (entity === PersonEntity) return personRepository;
        if (entity === UserEntity) return userRepository;
        return { exist: jest.fn().mockResolvedValue(true) };
      }),
    };

    decisionTreeService = {
      explainByModelName: jest.fn().mockResolvedValue({
        prediction: 'ACCEPT',
        roleAssignment: {
          mappedOccupationName: 'Farmer',
          suggestedRole: 'WORKER',
          rules: [],
          summary: 'summary',
          reason: 'reason',
          recommendedAttributes: {},
        },
        explanation: { admissionSummary: 'admission summary', admissionReason: 'admission reason' },
        predictionProbability: 0.9,
        rules: [],
      }),
    } as any;

    notificationService = {
      notifyCampRoles: jest.fn().mockResolvedValue(undefined),
      queueEmail: jest.fn().mockResolvedValue(undefined),
    };

    systemTimeService = {
      now: jest.fn().mockReturnValue(new Date('2024-01-02T03:04:05.000Z')),
      nowIso: jest.fn(),
      getServerTime: jest.fn(),
    } as any;

    storageService = {
      uploadImage: jest.fn(),
      getSignedUrl: jest.fn(),
      deleteImage: jest.fn(),
    } as any;

    jest.spyOn(EncryptionService, 'hashPassword').mockResolvedValue('hashed-password');

    service = new AdmissionRequestService(
      repository,
      dataSource as any,
      decisionTreeService,
      notificationService,
      systemTimeService,
      storageService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a request and triggers the AI flow', async () => {
    const createdRequest = {
      id: 1,
      campId: 1,
      email: 'test@example.com',
      desiredUsername: 'tester',
      name: 'Test',
      lastName1: 'User',
      lastName2: 'One',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    };

    repository.findByEmailAndCamp.mockResolvedValue(null);
    repository.create.mockResolvedValue(createdRequest);
    repository.findOccupationByName.mockResolvedValue({ id: 7, name: 'Farmer' });
    repository.update.mockResolvedValue({
      ...createdRequest,
      status: 'PENDING_ADMIN',
      suggestedOccupationId: 7,
    });

    const result = await service.createRequest({
      campId: 1,
      email: 'test@example.com',
      desiredUsername: 'tester',
      name: 'Test',
      lastName1: 'User',
      lastName2: 'One',
      birthDate: '2000-01-01',
      declaredHealthLevel: 'GOOD',
      previousExperience: 'none',
      physicalCondition: 'fit',
      declaredSkills: 'helpful',
    } as any);

    expect(result).toEqual({
      ...createdRequest,
      status: 'PENDING_ADMIN',
      suggestedOccupationId: 7,
    });
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(decisionTreeService.explainByModelName).toHaveBeenCalledTimes(1);
    expect(repository.saveAiAdmissionReport).toHaveBeenCalledTimes(1);
    expect(repository.update).toHaveBeenCalledWith(
      createdRequest.id,
      expect.objectContaining({ status: 'PENDING_ADMIN', suggestedOccupationId: 7 }),
    );
    expect(notificationService.notifyCampRoles).toHaveBeenCalled();
    expect(notificationService.queueEmail).toHaveBeenCalled();
  });

  it('rejects duplicate requests in the same camp', async () => {
    repository.findByEmailAndCamp.mockResolvedValue({ id: 99 });

    await expect(
      service.createRequest({
        campId: 1,
        email: 'dup@example.com',
        desiredUsername: 'dup',
        name: 'Dup',
        lastName1: 'User',
        birthDate: '2000-01-01',
        declaredHealthLevel: 'GOOD',
        previousExperience: 'none',
        physicalCondition: 'fit',
        declaredSkills: 'helpful',
      } as any),
    ).rejects.toThrow('Ya existe una solicitud con este correo para este campamento');
  });

  it('processes a pending AI request and notifies admins', async () => {
    repository.findById.mockResolvedValue({
      id: 10,
      campId: 1,
      status: 'PENDING_AI',
      email: 'ai@example.com',
      name: 'AI',
      lastName1: 'Review',
      desiredUsername: 'aireview',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    });
    repository.update.mockResolvedValue({
      id: 10,
      campId: 1,
      status: 'PENDING_ADMIN',
      email: 'ai@example.com',
      name: 'AI',
      lastName1: 'Review',
      desiredUsername: 'aireview',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    });

    const result = await service.processWithAI(10, 7, 'ACCEPT');

    expect(result.status).toBe('PENDING_ADMIN');
    expect(repository.update).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ suggestedOccupationId: 7, status: 'PENDING_ADMIN' }),
    );
    expect(notificationService.notifyCampRoles).toHaveBeenCalled();
  });

  it('rejects AI processing when the request is not pending AI', async () => {
    repository.findById.mockResolvedValue({ id: 11, status: 'APPROVED' });

    await expect(service.processWithAI(11, 7, 'ACCEPT')).rejects.toThrow(
      'Esta solicitud no esta pendiente de analisis de IA',
    );
  });

  it('approves a request through admin review and reuses existing access', async () => {
    repository.findById.mockResolvedValue({
      id: 20,
      campId: 1,
      status: 'PENDING_ADMIN',
      email: 'admin@example.com',
      desiredUsername: 'adminuser',
      name: 'Admin',
      lastName1: 'Person',
      lastName2: '',
      birthDate: '2000-01-01',
      declaredHealthLevel: 'GOOD',
      previousExperience: 'none',
      physicalCondition: 'fit',
      declaredSkills: 'helpful',
      finalOccupationId: null,
      suggestedOccupationId: 7,
    });
    repository.findApprovedByEmailExcludingId.mockResolvedValue(null);
    occupationRepository.findOne.mockResolvedValue({
      id: 7,
      name: 'Farmer',
      description: 'Field work',
      participatesInExpeditions: false,
      collectsResources: false,
    });
    personRepository.findOne.mockResolvedValue({ id: 33 });
    userRepository.findOne.mockResolvedValue({
      id: 44,
      role: 'WORKER',
      username: 'adminuser',
      personId: 33,
      email: 'admin@example.com',
      campId: 1,
    });
    repository.update.mockResolvedValue({
      id: 20,
      campId: 1,
      status: 'APPROVED',
      email: 'admin@example.com',
      desiredUsername: 'adminuser',
      name: 'Admin',
      lastName1: 'Person',
      lastName2: '',
      finalOccupationId: 7,
    });

    const result = await service.reviewByAdmin(20, 99, true, 7, 'WORKER');

    expect(result.status).toBe('APPROVED');
    expect(repository.update).toHaveBeenCalledWith(
      20,
      expect.objectContaining({ reviewedBy: 99, status: 'APPROVED', finalOccupationId: 7 }),
    );
    expect(notificationService.notifyCampRoles).toHaveBeenCalled();
    expect(notificationService.queueEmail).toHaveBeenCalled();
  });

  it('rejects a request through admin review with a reason', async () => {
    repository.findById.mockResolvedValue({
      id: 21,
      campId: 1,
      status: 'PENDING_ADMIN',
      email: 'reject@example.com',
      desiredUsername: 'rejectuser',
      name: 'Reject',
      lastName1: 'Me',
      lastName2: '',
      finalOccupationId: 7,
    });
    repository.update.mockResolvedValue({
      id: 21,
      campId: 1,
      status: 'REJECTED',
      email: 'reject@example.com',
      desiredUsername: 'rejectuser',
      name: 'Reject',
      lastName1: 'Me',
      lastName2: '',
      finalOccupationId: null,
      rejectionReason: 'No cumple',
    });

    const result = await service.reviewByAdmin(21, 99, false, undefined, undefined, 'No cumple');

    expect(result.status).toBe('REJECTED');
    expect(repository.update).toHaveBeenCalledWith(
      21,
      expect.objectContaining({
        reviewedBy: 99,
        status: 'REJECTED',
        finalOccupationId: null,
        rejectionReason: 'No cumple',
      }),
    );
  });

  it('uploads a new photo and deletes the previous one when present', async () => {
    repository.findById.mockResolvedValue({
      id: 30,
      photoUrl: 'previous.jpg',
      campId: 1,
    });
    storageService.deleteImage.mockResolvedValue(undefined);
    storageService.uploadImage.mockResolvedValue('admission-photos/new.jpg');
    repository.update.mockResolvedValue({
      id: 30,
      photoUrl: 'admission-photos/new.jpg',
      campId: 1,
    });

    const result = await service.uploadAdmissionRequestPhoto(30, {
      originalname: 'photo.jpg',
      mimetype: 'image/jpeg',
      buffer: Buffer.from('photo'),
    } as Express.Multer.File);

    expect(result.photoUrl).toBe('admission-photos/new.jpg');
    expect(storageService.deleteImage).toHaveBeenCalledWith('previous.jpg');
    expect(storageService.uploadImage).toHaveBeenCalledWith(expect.any(Object), 'admission-photos');
  });

  it('returns a request with a signed url when available', async () => {
    repository.findById.mockResolvedValue({
      id: 40,
      campId: 1,
      photoUrl: 'photos/request.jpg',
    });
    storageService.getSignedUrl.mockResolvedValue('https://example.com/signed.jpg');

    const result = await service.getAdmissionRequestWithSignedUrl(40);

    expect(result?.photoSignedUrl).toBe('https://example.com/signed.jpg');
  });

  it('returns all requests with signed urls', async () => {
    repository.findAll.mockResolvedValue([
      { id: 1, campId: 1, photoUrl: 'photos/one.jpg' },
      { id: 2, campId: 1, photoUrl: null },
    ]);
    storageService.getSignedUrl.mockResolvedValue('https://example.com/signed.jpg');

    const result = await service.getAllAdmissionRequestsWithSignedUrls({ campId: 1 });

    expect(result.data).toHaveLength(2);
    expect(result.data[0].photoSignedUrl).toBe('https://example.com/signed.jpg');
  });

  it('returns AI features for a request', async () => {
    repository.findById.mockResolvedValue({
      id: 50,
      name: 'AI',
      lastName1: 'User',
      lastName2: 'Test',
      email: 'ai@example.com',
      desiredUsername: 'aiuser',
      birthDate: '2000-01-01',
      photoUrl: null,
      declaredHealthLevel: 'GOOD',
      previousExperience: 'none',
      physicalCondition: 'fit',
      declaredSkills: 'helpful',
      healthLevelScore: 8,
      physicalConditionScore: 7,
      experienceYears: 2,
      skillsScore: 9,
    });

    const result = await service.getAiFeaturesByRequestId(50);

    expect(result.health_level_score).toBeDefined();
    expect(result.skills_score).toBeDefined();
  });
});
