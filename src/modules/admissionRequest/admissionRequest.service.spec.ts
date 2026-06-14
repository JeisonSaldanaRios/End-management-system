import { AdmissionRequestService } from './admissionRequest.service';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../../common/validation/assert-exists', () => ({
  assertEntityExists: jest.fn().mockResolvedValue(undefined),
}));

const repository = {
  findByEmailAndCamp: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
  findAll: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  countByCampAndStatus: jest.fn(),
  saveAiAdmissionReport: jest.fn(),
  findOccupationByName: jest.fn(),
  findApprovedByEmailExcludingId: jest.fn(),
};

const dataSource = {
  getRepository: jest.fn().mockReturnValue({
    findOne: jest.fn().mockResolvedValue(null),
    findOneOrFail: jest.fn(),
    save: jest.fn(),
    create: jest.fn().mockImplementation((data: unknown) => data),
  }),
};

const decisionTreeService = {
  explainByModelName: jest.fn(),
};

const notificationService = {
  notifyCampRoles: jest.fn().mockResolvedValue(undefined),
  queueEmail: jest.fn().mockResolvedValue(undefined),
  notifyUser: jest.fn().mockResolvedValue(null),
};

const systemTimeService = {
  now: jest.fn(),
};

const storageService = {
  uploadImage: jest.fn(),
  deleteImage: jest.fn(),
  getSignedUrl: jest.fn(),
};

const NOW = new Date('2026-03-01T08:00:00.000Z');

const BASE_REQUEST = {
  id: 1,
  name: 'Juan',
  lastName1: 'Perez',
  lastName2: 'Lopez',
  email: 'juan@test.com',
  desiredUsername: 'juan.perez',
  birthDate: new Date('2000-01-01'),
  gender: 'M',
  photoUrl: null,
  declaredHealthLevel: 'good',
  previousExperience: '3 years experience',
  physicalCondition: 'athletic',
  declaredSkills: 'medic, cook',
  campId: 1,
  status: 'PENDING_ADMIN' as const,
  createdAt: NOW,
  healthLevelScore: 8,
  physicalConditionScore: 9,
  experienceYears: 3,
  skillsScore: 5,
  suggestedOccupationId: 10,
  finalOccupationId: null,
  rejectionReason: null,
  reviewedBy: null,
  reviewDate: null,
};

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('AdmissionRequestService', () => {
  let service: AdmissionRequestService;

  beforeEach(() => {
    systemTimeService.now.mockReturnValue(new Date(NOW));
    service = new AdmissionRequestService(
      repository as never,
      dataSource as never,
      decisionTreeService as never,
      notificationService as never,
      systemTimeService as never,
      storageService as never,
    );
  });

  // ─── createRequest ──────────────────────────────────────────────────────

  describe('createRequest', () => {
    it('throws when email is already used for the same camp', async () => {
      repository.findByEmailAndCamp.mockResolvedValue({ id: 99 });

      await expect(service.createRequest({ ...BASE_REQUEST, campId: 1 })).rejects.toThrow(
        'Ya existe una solicitud con este correo para este campamento',
      );
    });

    it('creates request and returns it even when AI fails', async () => {
      repository.findByEmailAndCamp.mockResolvedValue(null);
      repository.create.mockResolvedValue(BASE_REQUEST);
      decisionTreeService.explainByModelName.mockRejectedValue(new Error('AI unavailable'));

      const result = await service.createRequest({ ...BASE_REQUEST });

      expect(result).toMatchObject({ id: 1 });
      expect(repository.create).toHaveBeenCalledTimes(1);
    });

    it('saves AI report when AI succeeds', async () => {
      repository.findByEmailAndCamp.mockResolvedValue(null);
      repository.create.mockResolvedValue(BASE_REQUEST);
      repository.findOccupationByName.mockResolvedValue({ id: 5 });
      repository.update.mockResolvedValue({
        ...BASE_REQUEST,
        status: 'PENDING_ADMIN',
        suggestedOccupationId: 5,
      });
      decisionTreeService.explainByModelName.mockResolvedValue({
        prediction: 'ACCEPT',
        rules: ['age > 18'],
        explanation: {
          admissionSummary: 'Accepted',
          admissionReason: 'Fits profile',
          roleSummary: 'Good role',
        },
        roleAssignment: {
          suggestedRole: 'Explorador',
          mappedOccupationName: 'Scout',
          rules: [],
          summary: 'Role ok',
          reason: 'Good fit',
          recommendedAttributes: ['strong'],
        },
      });
      repository.saveAiAdmissionReport.mockResolvedValue(undefined);

      await service.createRequest({ ...BASE_REQUEST });

      expect(repository.saveAiAdmissionReport).toHaveBeenCalledTimes(1);
      expect(repository.update).toHaveBeenCalledWith(
        BASE_REQUEST.id,
        expect.objectContaining({ status: 'PENDING_ADMIN', suggestedOccupationId: 5 }),
      );
    });
  });

  // ─── getRequestById ─────────────────────────────────────────────────────

  describe('getRequestById', () => {
    it('throws when request not found', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.getRequestById(999)).rejects.toThrow('Solicitud no encontrada');
    });

    it('returns the request when found', async () => {
      repository.findById.mockResolvedValue(BASE_REQUEST);
      const result = await service.getRequestById(1);
      expect(result).toMatchObject({ id: 1 });
    });
  });

  // ─── getAllRequests ──────────────────────────────────────────────────────

  describe('getAllRequests', () => {
    it('returns data and total using array length when no campId+status filter', async () => {
      repository.findAll.mockResolvedValue([BASE_REQUEST, BASE_REQUEST]);

      const result = await service.getAllRequests({ page: 1, limit: 10 });

      expect(result).toEqual({ data: [BASE_REQUEST, BASE_REQUEST], total: 2 });
    });

    it('returns correct total from countByCampAndStatus when both filters exist', async () => {
      repository.findAll.mockResolvedValue([BASE_REQUEST]);
      repository.countByCampAndStatus.mockResolvedValue(50);

      const result = await service.getAllRequests({
        campId: 1,
        status: 'PENDING_ADMIN',
        page: 1,
        limit: 10,
      });

      expect(result.total).toBe(50);
    });

    it('uses default page=1, limit=10 when no filter provided', async () => {
      repository.findAll.mockResolvedValue([]);

      await service.getAllRequests();

      expect(repository.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 0, limit: 10 }),
      );
    });
  });

  // ─── updateRequest ──────────────────────────────────────────────────────

  describe('updateRequest', () => {
    it('throws when request not found', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.updateRequest(999, {})).rejects.toThrow('Solicitud no encontrada');
    });

    it('throws when another request with same email+camp exists', async () => {
      repository.findById.mockResolvedValue(BASE_REQUEST);
      repository.findByEmailAndCamp.mockResolvedValue({ id: 555 });

      await expect(service.updateRequest(1, { email: 'other@test.com' })).rejects.toThrow(
        'Ya existe otra solicitud con este correo para este campamento',
      );
    });

    it('updates and returns the request on success', async () => {
      repository.findById.mockResolvedValue(BASE_REQUEST);
      repository.findByEmailAndCamp.mockResolvedValue(null);
      repository.update.mockResolvedValue({ ...BASE_REQUEST, status: 'REJECTED' });

      const result = await service.updateRequest(1, { status: 'REJECTED' });

      expect(result).toMatchObject({ status: 'REJECTED' });
    });
  });

  // ─── deleteRequest ──────────────────────────────────────────────────────

  describe('deleteRequest', () => {
    it('throws when request not found', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.deleteRequest(999)).rejects.toThrow('Solicitud no encontrada');
    });

    it('throws when trying to delete an approved request', async () => {
      repository.findById.mockResolvedValue({ ...BASE_REQUEST, status: 'APPROVED' });
      await expect(service.deleteRequest(1)).rejects.toThrow(
        'No se puede eliminar una solicitud aprobada',
      );
    });

    it('throws when deletion fails at repository level', async () => {
      repository.findById.mockResolvedValue({ ...BASE_REQUEST, status: 'PENDING_ADMIN' });
      repository.delete.mockResolvedValue(false);
      await expect(service.deleteRequest(1)).rejects.toThrow('Error al eliminar la solicitud');
    });

    it('deletes successfully when request is not approved', async () => {
      repository.findById.mockResolvedValue({ ...BASE_REQUEST, status: 'PENDING_AI' });
      repository.delete.mockResolvedValue(true);
      await expect(service.deleteRequest(1)).resolves.toBeUndefined();
    });
  });

  // ─── processWithAI ──────────────────────────────────────────────────────

  describe('processWithAI', () => {
    it('throws when request not found', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.processWithAI(999, 10, 'ACCEPT')).rejects.toThrow(
        'Solicitud no encontrada',
      );
    });

    it('throws when request is not PENDING_AI', async () => {
      repository.findById.mockResolvedValue({ ...BASE_REQUEST, status: 'PENDING_ADMIN' });
      await expect(service.processWithAI(1, 10, 'ACCEPT')).rejects.toThrow(
        'Esta solicitud no esta pendiente de analisis de IA',
      );
    });

    it('updates to PENDING_ADMIN when ACCEPT decision', async () => {
      repository.findById.mockResolvedValue({ ...BASE_REQUEST, status: 'PENDING_AI' });
      repository.update.mockResolvedValue({ ...BASE_REQUEST, status: 'PENDING_ADMIN' });

      const result = await service.processWithAI(1, 10, 'ACCEPT');

      expect(result.status).toBe('PENDING_ADMIN');
      expect(repository.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ status: 'PENDING_ADMIN', suggestedOccupationId: 10 }),
      );
    });

    it('keeps request pending admin when AI recommendation is REJECT', async () => {
      repository.findById.mockResolvedValue({ ...BASE_REQUEST, status: 'PENDING_AI' });
      repository.update.mockResolvedValue({ ...BASE_REQUEST, status: 'PENDING_ADMIN' });

      const result = await service.processWithAI(1, 10, 'REJECT');

      expect(result.status).toBe('PENDING_ADMIN');
      expect(repository.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ status: 'PENDING_ADMIN', suggestedOccupationId: 10 }),
      );
    });
  });

  // ─── reviewByAdmin ──────────────────────────────────────────────────────

  describe('reviewByAdmin', () => {
    it('throws when request not found', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.reviewByAdmin(999, 1, true)).rejects.toThrow('Solicitud no encontrada');
    });

    it('throws when request is not PENDING_ADMIN', async () => {
      repository.findById.mockResolvedValue({ ...BASE_REQUEST, status: 'PENDING_AI' });
      await expect(service.reviewByAdmin(1, 1, true)).rejects.toThrow(
        'Esta solicitud no esta pendiente de revision administrativa',
      );
    });

    it('throws when approving but no occupation assigned', async () => {
      repository.findById.mockResolvedValue({
        ...BASE_REQUEST,
        status: 'PENDING_ADMIN',
        suggestedOccupationId: 10,
        finalOccupationId: null,
      });
      repository.findApprovedByEmailExcludingId.mockResolvedValue(null);

      await expect(service.reviewByAdmin(1, 1, true)).rejects.toThrow(
        'No se puede aprobar la solicitud sin un oficio final seleccionado por el administrador',
      );
    });

    it('throws when email was already approved in another camp', async () => {
      repository.findById.mockResolvedValue({ ...BASE_REQUEST, status: 'PENDING_ADMIN' });
      repository.findApprovedByEmailExcludingId.mockResolvedValue({ id: 42 });

      await expect(service.reviewByAdmin(1, 1, true, 10, 'RESOURCE_MANAGEMENT')).rejects.toThrow(
        'Esta persona ya fue aprobada en otro campamento',
      );
    });

    it('throws when approving but no role assigned', async () => {
      repository.findById.mockResolvedValue({ ...BASE_REQUEST, status: 'PENDING_ADMIN' });
      repository.findApprovedByEmailExcludingId.mockResolvedValue(null);

      await expect(service.reviewByAdmin(1, 1, true, 10)).rejects.toThrow(
        'No se puede aprobar la solicitud sin un rol final seleccionado por el administrador',
      );
    });

    it('rejects the request when approved=false', async () => {
      repository.findById.mockResolvedValue({ ...BASE_REQUEST, status: 'PENDING_ADMIN' });
      repository.update.mockResolvedValue({ ...BASE_REQUEST, status: 'REJECTED' });

      const result = await service.reviewByAdmin(
        1,
        5,
        false,
        undefined,
        undefined,
        'Not qualified',
      );

      expect(result.status).toBe('REJECTED');
      expect(repository.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          status: 'REJECTED',
          rejectionReason: 'Not qualified',
        }),
      );
    });
  });

  // ─── getPendingByCamp ────────────────────────────────────────────────────

  describe('getPendingByCamp', () => {
    it('returns pending requests for the camp', async () => {
      repository.findAll.mockResolvedValue([BASE_REQUEST]);

      const result = await service.getPendingByCamp(1);

      expect(result).toHaveLength(1);
      expect(repository.findAll).toHaveBeenCalledWith({ campId: 1, status: 'PENDING_ADMIN' });
    });
  });

  // ─── getAiFeaturesByRequestId ────────────────────────────────────────────

  describe('getAiFeaturesByRequestId', () => {
    it('throws when request not found', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.getAiFeaturesByRequestId(999)).rejects.toThrow(
        'Solicitud no encontrada',
      );
    });

    it('returns feature vector for existing request', async () => {
      repository.findById.mockResolvedValue(BASE_REQUEST);

      const result = await service.getAiFeaturesByRequestId(1);

      expect(result).toMatchObject({
        age_years: expect.any(Number),
        health_level_score: expect.any(Number),
        physical_condition_score: expect.any(Number),
        experience_years: expect.any(Number),
        skills_score: expect.any(Number),
      });
    });
  });
});
