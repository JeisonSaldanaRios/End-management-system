import { DataSource } from 'typeorm';

import { assertEntityExists } from '../../common/validation/assert-exists';
import { OccupationEntity } from '../occupation/occupation.entity';
import { AiAdmissionReportService } from './aiAdmissionReport.service';
import type { AiAdmissionReport, CreateAiAdmissionReportDTO } from './aiAdmissionReport.model';

jest.mock('../../common/validation/assert-exists', () => ({
  assertEntityExists: jest.fn(),
}));

describe('AiAdmissionReportService', () => {
  const mockedAssertEntityExists = assertEntityExists as jest.MockedFunction<
    typeof assertEntityExists
  >;

  const repository = {
    admissionRequestExists: jest.fn(),
    findByRequestId: jest.fn(),
    create: jest.fn(),
    findAdmissionRequestCampId: jest.fn(),
    findById: jest.fn(),
    findReportCampId: jest.fn(),
    findAllAndCount: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  const notificationService = {
    notifyCampRoles: jest.fn(),
  };

  let service: AiAdmissionReportService;

  const createPayload: CreateAiAdmissionReportDTO = {
    requestId: 10,
    submittedData: { sample: true },
    aiResponse: { result: 'ok' },
    aiDecision: 'ACCEPT',
  };

  const report: AiAdmissionReport = {
    id: 99,
    requestId: 10,
    submittedData: {},
    aiResponse: {},
    aiDecision: 'ACCEPT',
    aiJustification: null,
    suggestedOccupationId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AiAdmissionReportService(
      repository as never,
      {} as DataSource,
      notificationService as never,
    );
  });

  it('throws when admission request does not exist', async () => {
    repository.admissionRequestExists.mockResolvedValue(false);

    await expect(service.createReport(createPayload)).rejects.toThrow(
      'Solicitud de admision no encontrada',
    );
  });

  it('throws when a report already exists for request', async () => {
    repository.admissionRequestExists.mockResolvedValue(true);
    repository.findByRequestId.mockResolvedValue(report);

    await expect(service.createReport(createPayload)).rejects.toThrow(
      'Ya existe un reporte de IA de admision para esta solicitud',
    );
  });

  it('creates report, validates occupation, and notifies camp admins', async () => {
    repository.admissionRequestExists.mockResolvedValue(true);
    repository.findByRequestId.mockResolvedValue(null);
    repository.create.mockResolvedValue(report);
    repository.findAdmissionRequestCampId.mockResolvedValue(4);

    const payloadWithOccupation = { ...createPayload, suggestedOccupationId: 7 };

    await expect(service.createReport(payloadWithOccupation)).resolves.toEqual(report);

    expect(mockedAssertEntityExists).toHaveBeenCalledWith(
      expect.anything(),
      OccupationEntity,
      7,
      'Occupation',
    );
    expect(notificationService.notifyCampRoles).toHaveBeenCalledWith(4, ['SYSTEM_ADMIN'], {
      type: 'ADMISSION_REQUEST_AI_REVIEWED',
      title: 'Reporte de IA de admision creado',
      message: 'Se creo un reporte de IA para la solicitud 10.',
      sourceType: 'ai_admission_report',
      sourceId: 99,
      sendEmail: false,
    });
  });

  it('creates report without notification when camp cannot be resolved', async () => {
    repository.admissionRequestExists.mockResolvedValue(true);
    repository.findByRequestId.mockResolvedValue(null);
    repository.create.mockResolvedValue(report);
    repository.findAdmissionRequestCampId.mockResolvedValue(null);

    await service.createReport(createPayload);

    expect(notificationService.notifyCampRoles).not.toHaveBeenCalled();
  });

  it('returns repository values for the basic getter methods', async () => {
    repository.findById.mockResolvedValue(report);
    repository.findByRequestId.mockResolvedValue(report);
    repository.findReportCampId.mockResolvedValue(8);
    repository.findAdmissionRequestCampId.mockResolvedValue(4);

    await expect(service.getReportById(99)).resolves.toEqual(report);
    await expect(service.getReportByRequestId(10)).resolves.toEqual(report);
    await expect(service.getReportCampId(99)).resolves.toBe(8);
    await expect(service.getAdmissionRequestCampId(10)).resolves.toBe(4);
  });

  it('maps pagination and optional filters in getAllReports', async () => {
    repository.findAllAndCount.mockResolvedValue({ data: [report], total: 1 });

    await expect(
      service.getAllReports({
        campId: 1,
        requestId: 10,
        aiDecision: 'ACCEPT',
        suggestedOccupationId: 3,
        page: 3,
        limit: 5,
      }),
    ).resolves.toEqual({ data: [report], total: 1 });

    expect(repository.findAllAndCount).toHaveBeenCalledWith({
      campId: 1,
      requestId: 10,
      aiDecision: 'ACCEPT',
      suggestedOccupationId: 3,
      offset: 10,
      limit: 5,
    });
  });

  it('returns null in updateReport when report does not exist', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.updateReport(1, { aiDecision: 'REJECT' })).resolves.toBeNull();
  });

  it('throws in updateReport when new request id does not exist', async () => {
    repository.findById.mockResolvedValue(report);
    repository.admissionRequestExists.mockResolvedValue(false);

    await expect(service.updateReport(99, { requestId: 55 })).rejects.toThrow(
      'Solicitud de admision no encontrada',
    );
  });

  it('throws in updateReport when target request already has another report', async () => {
    repository.findById.mockResolvedValue(report);
    repository.admissionRequestExists.mockResolvedValue(true);
    repository.findByRequestId.mockResolvedValue({ ...report, id: 100, requestId: 55 });

    await expect(service.updateReport(99, { requestId: 55 })).rejects.toThrow(
      'Ya existe un reporte de IA de admision para esta solicitud',
    );
  });

  it('updates report and sends notification when camp id is available', async () => {
    repository.findById.mockResolvedValue(report);
    repository.update.mockResolvedValue({ ...report, aiDecision: 'REJECT' });
    repository.findAdmissionRequestCampId.mockResolvedValue(3);

    const updated = await service.updateReport(99, {
      aiDecision: 'REJECT',
      suggestedOccupationId: 22,
    });

    expect(updated?.aiDecision).toBe('REJECT');
    expect(mockedAssertEntityExists).toHaveBeenCalledWith(
      expect.anything(),
      OccupationEntity,
      22,
      'Occupation',
    );
    expect(notificationService.notifyCampRoles).toHaveBeenCalledWith(3, ['SYSTEM_ADMIN'], {
      type: 'ADMISSION_REQUEST_AI_REVIEWED',
      title: 'Reporte de IA de admision actualizado',
      message: 'Se actualizo el reporte de IA para la solicitud 10.',
      sourceType: 'ai_admission_report',
      sourceId: 99,
      sendEmail: false,
    });
  });

  it('updates report without notification when camp id cannot be resolved', async () => {
    repository.findById.mockResolvedValue(report);
    repository.update.mockResolvedValue({ ...report, aiDecision: 'REJECT' });
    repository.findAdmissionRequestCampId.mockResolvedValue(null);

    await expect(service.updateReport(99, { aiDecision: 'REJECT' })).resolves.toMatchObject({
      aiDecision: 'REJECT',
    });

    expect(notificationService.notifyCampRoles).not.toHaveBeenCalled();
  });

  it('returns false in deleteReport when target does not exist', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.deleteReport(10)).resolves.toBe(false);
  });

  it('returns false in deleteReport when repository deletion fails', async () => {
    repository.findById.mockResolvedValue(report);
    repository.delete.mockResolvedValue(false);

    await expect(service.deleteReport(10)).resolves.toBe(false);
  });

  it('deletes report and notifies camp admins', async () => {
    repository.findById.mockResolvedValue(report);
    repository.delete.mockResolvedValue(true);
    repository.findAdmissionRequestCampId.mockResolvedValue(4);

    await expect(service.deleteReport(10)).resolves.toBe(true);

    expect(notificationService.notifyCampRoles).toHaveBeenCalledWith(4, ['SYSTEM_ADMIN'], {
      type: 'ADMISSION_REQUEST_AI_REVIEWED',
      title: 'Reporte de IA de admision eliminado',
      message: 'Se elimino el reporte de IA para la solicitud 10.',
      sourceType: 'ai_admission_report',
      sourceId: 99,
      sendEmail: false,
    });
  });

  it('deletes report without notification when camp id cannot be resolved', async () => {
    repository.findById.mockResolvedValue(report);
    repository.delete.mockResolvedValue(true);
    repository.findAdmissionRequestCampId.mockResolvedValue(null);

    await expect(service.deleteReport(10)).resolves.toBe(true);

    expect(notificationService.notifyCampRoles).not.toHaveBeenCalled();
  });
});
