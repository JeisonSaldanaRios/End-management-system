import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';

import { assertEntityExists } from '../../common/validation/assert-exists';
import { EncryptionService } from '../../services/encryption.service';
import { CampEntity } from '../camp/camp.entity';
import { OccupationEntity } from '../occupation/occupation.entity';
import { AI_DECISION_VALUES } from '../aiAdmissionReport/aiAdmissionReport.model';
import { NotificationService } from '../notification/notification.service';
import type { SystemRole } from '../systemUser/systemUser.model';
import { UserEntity } from '../systemUser/systemUser.entity';
import { PersonEntity } from '../person/person.entity';
import { DecisionTreeService } from '../decisionTree/decisionTree.service';
import { SystemTimeService } from '../systemTime/systemTime.service';
import { AdmissionRequestRepository } from './admissionRequest.repository';
import {
  CreateAdmissionRequestDTO,
  UpdateAdmissionRequestDTO,
  AdmissionRequest,
  AdmissionRequestStatus,
} from './admissionRequest.model';
import { buildAdmissionFeatures, type AdmissionFeatureVector } from './admissionFeatures.util';
import { R2StorageService } from '../../services/r2-storage.service';

const ADMISSION_MODEL_NAME = 'admission-acceptance-v1';
const ADMISSION_REVIEW_ROLE_VALUES: readonly SystemRole[] = [
  'WORKER',
  'RESOURCE_MANAGEMENT',
  'TRAVEL_MANAGER',
  'SYSTEM_ADMIN',
];

const AI_ROLE_TO_SYSTEM_ROLE: Record<string, SystemRole> = {
  'Medico': 'RESOURCE_MANAGEMENT',
  'Ingeniero': 'RESOURCE_MANAGEMENT',
  'Guardia': 'WORKER',
  'Explorador': 'WORKER',
  'Recolector de agua': 'WORKER',
  'Recolector de comida': 'WORKER',
};

function resolveSystemRoleFromAiSuggestion(suggestedRole: string): SystemRole {
  return AI_ROLE_TO_SYSTEM_ROLE[suggestedRole] ?? 'WORKER';
}

interface AiReviewContext {
  aiDecision?: string;
  suggestedRole?: string;
  suggestedOccupationName?: string;
  admissionSummary?: string;
  admissionReason?: string;
  roleSummary?: string;
  roleReason?: string;
}

interface CreatedAccessContext {
  username: string;
  generatedPassword: string | null;
  role: SystemRole;
  occupationName: string;
  occupationDescription: string;
}

@Injectable()
export class AdmissionRequestService {
  private readonly logger = new Logger(AdmissionRequestService.name);
  private repository: AdmissionRequestRepository;

  constructor(
    repository: AdmissionRequestRepository,
    private readonly dataSource: DataSource,
    private readonly decisionTreeService: DecisionTreeService,
    private readonly notificationService: NotificationService,
    private readonly systemTimeService: SystemTimeService,
    private readonly storageService: R2StorageService,
  ) {
    this.repository = repository;
  }

  async createRequest(data: CreateAdmissionRequestDTO): Promise<AdmissionRequest> {
    await assertEntityExists(this.dataSource, CampEntity, data.campId, 'Camp');

    const existingRequest = await this.repository.findByEmailAndCamp(data.email, data.campId);

    if (existingRequest) {
      throw new Error('Ya existe una solicitud con este correo para este campamento');
    }

    const normalizedData = this.normalizeAiFieldsForCreate(data);
    const createdRequest = await this.repository.create(normalizedData);
    let requestToReturn = createdRequest;
    await this.notifyInitialAdmissionRequest(createdRequest);

    try {
      const features = buildAdmissionFeatures(normalizedData);
      const aiExplain = await this.decisionTreeService.explainByModelName(
        ADMISSION_MODEL_NAME,
        {
          age_years: features.age_years,
          health_level_score: features.health_level_score,
          physical_condition_score: features.physical_condition_score,
          experience_years: features.experience_years,
          skills_score: features.skills_score,
        },
        createdRequest.campId,
      );

      const mappedOccupationName = aiExplain.roleAssignment.mappedOccupationName;
      const assignedOccupation = await this.repository.findOccupationByName(mappedOccupationName);

      const aiDecision = this.normalizeAiDecision(aiExplain.prediction);

      let nextStatus: AdmissionRequestStatus = 'PENDING_ADMIN';
      let autoApproved = false;
      let autoRejected = false;

      if (aiExplain.decisionAction === 'AUTO_APPROVE') {
        nextStatus = 'APPROVED';
        autoApproved = true;
      } else if (aiExplain.decisionAction === 'AUTO_REJECT') {
        nextStatus = 'REJECTED';
        autoRejected = true;
      }

      await this.repository.saveAiAdmissionReport({
        requestId: createdRequest.id,
        submittedData: {
          features,
        },
        aiResponse: {
          admission: {
            prediction: aiExplain.prediction,
            rules: aiExplain.rules,
            summary: aiExplain.explanation.admissionSummary,
            reason: aiExplain.explanation.admissionReason,
          },
          roleAssignment: {
            suggestedRole: aiExplain.roleAssignment.suggestedRole,
            mappedOccupationName,
            suggestedOccupationId: assignedOccupation?.id ?? null,
            rules: aiExplain.roleAssignment.rules,
            summary: aiExplain.roleAssignment.summary,
            reason: aiExplain.roleAssignment.reason,
            recommendedAttributes: aiExplain.roleAssignment.recommendedAttributes,
          },
        },
        aiDecision,
        aiJustification: aiExplain.explanation.admissionReason,
        suggestedOccupationId: assignedOccupation?.id ?? null,
      });

      const updateData: Partial<UpdateAdmissionRequestDTO> = {
        suggestedOccupationId: assignedOccupation?.id ?? null,
        status: nextStatus,
      };

      if (autoApproved) {
        updateData.finalOccupationId = assignedOccupation?.id ?? null;
        updateData.reviewDate = this.systemTimeService.now();
      } else if (autoRejected) {
        updateData.rejectionReason = `Rechazado automáticamente por la IA. Motivo: ${aiExplain.explanation?.admissionReason || 'Puntaje de confianza muy bajo'}`;
        updateData.reviewDate = this.systemTimeService.now();
      }

      const updatedRequest = await this.repository.update(
        createdRequest.id,
        updateData as UpdateAdmissionRequestDTO,
      );

      if (!updatedRequest) {
        throw new Error('Error al actualizar la solicitud despues del reporte de IA');
      }

      requestToReturn = updatedRequest;

      let createdAccess = null;
      if (autoApproved && assignedOccupation) {
        const aiAssignedRole = resolveSystemRoleFromAiSuggestion(
          aiExplain.roleAssignment.suggestedRole,
        );
        createdAccess = await this.createPersonAndUserForApprovedRequest(
          updatedRequest,
          assignedOccupation.id,
          aiAssignedRole,
        );
      }

      if (autoApproved) {
        await this.notifyAdminReviewResult(updatedRequest, true, createdAccess);
      } else if (autoRejected) {
        await this.notifyAdminReviewResult(updatedRequest, false, null);
      } else {
        await this.notifyAiReviewResult(updatedRequest, {
          aiDecision: aiExplain.prediction,
          suggestedRole: aiExplain.roleAssignment.suggestedRole,
          suggestedOccupationName: aiExplain.roleAssignment.mappedOccupationName,
          admissionSummary: aiExplain.explanation.admissionSummary,
          admissionReason: aiExplain.explanation.admissionReason,
          roleSummary: aiExplain.roleAssignment.summary,
          roleReason: aiExplain.roleAssignment.reason,
        });
      }
    } catch (error) {
      this.logger.warn(
        `AI auto-review failed for admission request ${createdRequest.id} (camp ${createdRequest.campId}): ${error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }

    return requestToReturn;
  }

  async getRequestById(id: number): Promise<AdmissionRequest> {
    const request = await this.repository.findById(id);

    if (!request) {
      throw new Error('Solicitud no encontrada');
    }

    return request;
  }

  async getAllRequests(filters?: {
    campId?: number;
    status?: AdmissionRequestStatus;
    page?: number;
    limit?: number;
  }): Promise<{ data: AdmissionRequest[]; total: number }> {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 10;
    const offset = (page - 1) * limit;

    const findAllFilters: {
      campId?: number;
      status?: AdmissionRequestStatus;
      limit: number;
      offset: number;
    } = {
      limit,
      offset,
    };

    if (filters?.campId !== undefined) {
      findAllFilters.campId = filters.campId;
    }

    if (filters?.status !== undefined) {
      findAllFilters.status = filters.status;
    }

    const data = await this.repository.findAll(findAllFilters);

    let total = 0;
    if (filters?.campId && filters?.status) {
      total = await this.repository.countByCampAndStatus(filters.campId, filters.status);
    } else {
      total = data.length;
    }

    return { data, total };
  }

  async updateRequest(id: number, data: UpdateAdmissionRequestDTO): Promise<AdmissionRequest> {
    const existingRequest = await this.repository.findById(id);

    if (!existingRequest) {
      throw new Error('Solicitud no encontrada');
    }

    const targetCampId = data.campId ?? existingRequest.campId;

    if (
      (data.email && data.email !== existingRequest.email) ||
      (data.campId !== undefined && data.campId !== existingRequest.campId)
    ) {
      const requestWithEmail = await this.repository.findByEmailAndCamp(
        data.email ?? existingRequest.email,
        targetCampId,
      );
      if (requestWithEmail && requestWithEmail.id !== existingRequest.id) {
        throw new Error('Ya existe otra solicitud con este correo para este campamento');
      }
    }

    if (data.campId !== undefined) {
      await assertEntityExists(this.dataSource, CampEntity, data.campId, 'Camp');
    }

    if (data.suggestedOccupationId !== undefined && data.suggestedOccupationId !== null) {
      await assertEntityExists(
        this.dataSource,
        OccupationEntity,
        data.suggestedOccupationId,
        'Occupation',
      );
    }

    if (data.finalOccupationId !== undefined && data.finalOccupationId !== null) {
      await assertEntityExists(
        this.dataSource,
        OccupationEntity,
        data.finalOccupationId,
        'Occupation',
      );
    }

    if (data.reviewedBy !== undefined && data.reviewedBy !== null) {
      await assertEntityExists(this.dataSource, UserEntity, data.reviewedBy, 'User');
    }

    const updatedRequest = await this.repository.update(id, data);
    if (!updatedRequest) {
      throw new Error('Error al actualizar la solicitud');
    }

    return updatedRequest;
  }

  async deleteRequest(id: number): Promise<void> {
    const existingRequest = await this.repository.findById(id);

    if (!existingRequest) {
      throw new Error('Solicitud no encontrada');
    }

    if (existingRequest.status === 'APPROVED') {
      throw new Error('No se puede eliminar una solicitud aprobada');
    }

    const deleted = await this.repository.delete(id);

    if (!deleted) {
      throw new Error('Error al eliminar la solicitud');
    }
  }

  async processWithAI(
    id: number,
    suggestedOccupationId: number,
    _decision: 'ACCEPT' | 'REJECT',
  ): Promise<AdmissionRequest> {
    const request = await this.repository.findById(id);

    if (!request) {
      throw new Error('Solicitud no encontrada');
    }

    if (request.status !== 'PENDING_AI') {
      throw new Error('Esta solicitud no esta pendiente de analisis de IA');
    }

    await assertEntityExists(
      this.dataSource,
      OccupationEntity,
      suggestedOccupationId,
      'Occupation',
    );

    const updateData: UpdateAdmissionRequestDTO = {
      suggestedOccupationId,
      status: 'PENDING_ADMIN',
    };

    const updatedRequest = await this.repository.update(id, updateData);

    if (!updatedRequest) {
      throw new Error('Error al procesar la solicitud con IA');
    }

    await this.notifyAiReviewResult(updatedRequest);

    return updatedRequest;
  }

  async reviewByAdmin(
    id: number,
    adminUserId: number,
    approved: boolean,
    finalOccupationId?: number,
    finalRole?: SystemRole,
    rejectionReason?: string,
  ): Promise<AdmissionRequest> {
    const request = await this.repository.findById(id);

    if (!request) {
      throw new Error('Solicitud no encontrada');
    }

    if (request.status !== 'PENDING_ADMIN') {
      throw new Error('Esta solicitud no esta pendiente de revision administrativa');
    }

    await assertEntityExists(this.dataSource, UserEntity, adminUserId, 'User');

    if (approved) {
      const existingApprovedRequest = await this.repository.findApprovedByEmailExcludingId(
        request.email,
        request.id,
      );

      if (existingApprovedRequest) {
        throw new Error(
          'Esta persona ya fue aprobada en otro campamento y no puede ser aprobada nuevamente',
        );
      }
    }

    const assignedOccupationIdOnApproval = approved ? (finalOccupationId ?? null) : null;

    if (approved && !assignedOccupationIdOnApproval) {
      throw new Error(
        'No se puede aprobar la solicitud sin un oficio final seleccionado por el administrador',
      );
    }

    if (approved && !finalRole) {
      throw new Error(
        'No se puede aprobar la solicitud sin un rol final seleccionado por el administrador',
      );
    }

    if (approved && finalRole && !ADMISSION_REVIEW_ROLE_VALUES.includes(finalRole)) {
      throw new Error('Rol final invalido para una solicitud de admision');
    }

    if (approved && assignedOccupationIdOnApproval) {
      await assertEntityExists(
        this.dataSource,
        OccupationEntity,
        assignedOccupationIdOnApproval,
        'Occupation',
      );
    }

    let createdAccess: CreatedAccessContext | null = null;

    if (approved && assignedOccupationIdOnApproval && finalRole) {
      createdAccess = await this.createPersonAndUserForApprovedRequest(
        request,
        assignedOccupationIdOnApproval,
        finalRole,
      );
    }

    const updateData: UpdateAdmissionRequestDTO = {
      reviewedBy: adminUserId,
      reviewDate: this.systemTimeService.now(),
      status: approved ? 'APPROVED' : 'REJECTED',
      finalOccupationId: assignedOccupationIdOnApproval,
      occupationModified:
        approved && assignedOccupationIdOnApproval !== null
          ? assignedOccupationIdOnApproval !== request.suggestedOccupationId
          : request.occupationModified,
      rejectionReason: approved ? null : rejectionReason || 'Solicitud rechazada',
    };

    const updatedRequest = await this.repository.update(id, updateData);

    if (!updatedRequest) {
      throw new Error('Error al revisar la solicitud');
    }

    if (approved && assignedOccupationIdOnApproval && finalRole && createdAccess === null) {
      createdAccess = await this.createPersonAndUserForApprovedRequest(
        updatedRequest,
        assignedOccupationIdOnApproval,
        finalRole,
      );
    }

    await this.notifyAdminReviewResult(updatedRequest, approved, createdAccess);

    return updatedRequest;
  }

  async getPendingByCamp(campId: number): Promise<AdmissionRequest[]> {
    return await this.repository.findAll({
      campId,
      status: 'PENDING_ADMIN',
    });
  }

  async getAiFeaturesByRequestId(id: number): Promise<AdmissionFeatureVector> {
    const request = await this.repository.findById(id);
    if (!request) {
      throw new Error('Solicitud no encontrada');
    }

    return buildAdmissionFeatures({
      name: request.name,
      lastName1: request.lastName1,
      lastName2: request.lastName2,
      email: request.email,
      desiredUsername: request.desiredUsername,
      birthDate: request.birthDate,
      photoUrl: request.photoUrl,
      declaredHealthLevel: request.declaredHealthLevel,
      previousExperience: request.previousExperience,
      physicalCondition: request.physicalCondition,
      declaredSkills: request.declaredSkills,
      healthLevelScore: request.healthLevelScore,
      physicalConditionScore: request.physicalConditionScore,
      experienceYears: request.experienceYears,
      skillsScore: request.skillsScore,
    });
  }

  private normalizeAiFieldsForCreate(data: CreateAdmissionRequestDTO): CreateAdmissionRequestDTO {
    const features = buildAdmissionFeatures(data);

    return {
      ...data,
      healthLevelScore: data.healthLevelScore ?? features.health_level_score,
      physicalConditionScore: data.physicalConditionScore ?? features.physical_condition_score,
      experienceYears: data.experienceYears ?? features.experience_years,
      skillsScore: data.skillsScore ?? features.skills_score,
    };
  }

  private normalizeAiDecision(prediction: string): (typeof AI_DECISION_VALUES)[number] {
    if (prediction === 'ACCEPT') {
      return 'ACCEPT';
    }

    if (prediction === 'REJECT') {
      return 'REJECT';
    }

    throw new Error(`Prediccion de admision invalida para el reporte de IA: ${prediction}`);
  }

  private normalizeAiFieldsForUpdate(
    data: UpdateAdmissionRequestDTO,
    existingRequest: AdmissionRequest,
  ): UpdateAdmissionRequestDTO {
    const mergedForFeatures: CreateAdmissionRequestDTO = {
      name: data.name ?? existingRequest.name,
      lastName1: data.lastName1 ?? existingRequest.lastName1,
      lastName2: data.lastName2 ?? existingRequest.lastName2,
      email: data.email ?? existingRequest.email,
      desiredUsername: data.desiredUsername ?? existingRequest.desiredUsername,
      birthDate: data.birthDate ?? existingRequest.birthDate,
      gender: data.gender ?? existingRequest.gender,
      photoUrl: data.photoUrl ?? existingRequest.photoUrl,
      declaredHealthLevel: data.declaredHealthLevel ?? existingRequest.declaredHealthLevel,
      previousExperience: data.previousExperience ?? existingRequest.previousExperience,
      physicalCondition: data.physicalCondition ?? existingRequest.physicalCondition,
      declaredSkills: data.declaredSkills ?? existingRequest.declaredSkills,
      campId: data.campId ?? existingRequest.campId,
      healthLevelScore: data.healthLevelScore ?? existingRequest.healthLevelScore,
      physicalConditionScore: data.physicalConditionScore ?? existingRequest.physicalConditionScore,
      experienceYears: data.experienceYears ?? existingRequest.experienceYears,
      skillsScore: data.skillsScore ?? existingRequest.skillsScore,
    };

    const features = buildAdmissionFeatures(mergedForFeatures);

    return {
      ...data,
      healthLevelScore: data.healthLevelScore ?? features.health_level_score,
      physicalConditionScore: data.physicalConditionScore ?? features.physical_condition_score,
      experienceYears: data.experienceYears ?? features.experience_years,
      skillsScore: data.skillsScore ?? features.skills_score,
    };
  }

  private async notifyInitialAdmissionRequest(request: AdmissionRequest): Promise<void> {
    const applicantName = this.buildApplicantName(request);

    await this.notificationService.notifyCampRoles(request.campId, ['SYSTEM_ADMIN'], {
      type: 'ADMISSION_REQUEST_PENDING',
      title: 'Nueva solicitud de admision',
      message: `Hay una nueva solicitud de admision pendiente de revision (ID: ${request.id}).`,
      sourceType: 'admission_request',
      sourceId: request.id,
    });

    await this.notificationService.queueEmail({
      toEmail: request.email,
      subject: 'Solicitud de ingreso recibida',
      templateKey: 'admission_request_pending',
      payload: {
        title: 'Solicitud de ingreso recibida',
        message: `Hola ${applicantName}, recibimos tu solicitud y pronto sera revisada por administracion.`,
        sourceType: 'admission_request',
        details: {
          nombreSolicitante: applicantName,
          campId: request.campId,
          correoSolicitante: request.email,
          usuarioDeseado: request.desiredUsername,
          fechaSolicitud: request.createdAt.toISOString(),
        },
      },
    });
  }

  private async notifyAiReviewResult(
    request: AdmissionRequest,
    aiContext?: AiReviewContext,
  ): Promise<void> {
    const applicantName = this.buildApplicantName(request);

    if (request.status === 'PENDING_ADMIN') {
      await this.notificationService.notifyCampRoles(request.campId, ['SYSTEM_ADMIN'], {
        type: 'ADMISSION_REQUEST_AI_REVIEWED',
        title: 'Solicitud evaluada por IA',
        message: `La solicitud ${request.id} fue evaluada por IA y esta lista para revision administrativa.`,
        sourceType: 'admission_request',
        sourceId: request.id,
        email: {
          subject: `Analisis IA listo para solicitud #${request.id}`,
          templateKey: 'admission_request_ai_reviewed',
          payload: {
            title: `Analisis IA listo para solicitud #${request.id}`,
            message:
              'La IA finalizo el analisis de la solicitud. Revisa el resumen, valida el oficio propuesto y decide aprobar o ajustar antes de aprobar.',
            sourceType: 'admission_request',
            sourceId: request.id,
            details: {
              solicitudId: request.id,
              nombreSolicitante: applicantName,
              correoSolicitante: request.email,
              usuarioDeseado: request.desiredUsername,
              campId: request.campId,
              decisionIA: aiContext?.aiDecision ?? 'NO_DISPONIBLE',
              rolSugeridoIA: aiContext?.suggestedRole ?? 'NO_DISPONIBLE',
              oficioSugeridoIA: aiContext?.suggestedOccupationName ?? 'NO_DISPONIBLE',
              resumenAdmisionIA: aiContext?.admissionSummary ?? 'Sin resumen disponible',
              motivoAdmisionIA: aiContext?.admissionReason ?? 'Sin razon disponible',
              resumenRolIA: aiContext?.roleSummary ?? 'Sin resumen disponible',
              motivoRolIA: aiContext?.roleReason ?? 'Sin razon disponible',
            },
          },
        },
      });

      await this.notificationService.queueEmail({
        toEmail: request.email,
        subject: 'Solicitud en revision administrativa',
        templateKey: 'admission_request_ai_reviewed',
        payload: {
          title: 'Solicitud en revision administrativa',
          message: `Hola ${applicantName}, tu solicitud fue recibida y ahora esta en revision administrativa.`,
          sourceType: 'admission_request',
          details: {
            estadoSolicitud: 'EN_REVISION_ADMINISTRATIVA',
          },
        },
      });
      return;
    }

    if (request.status === 'PENDING_AI') {
      await this.notificationService.notifyCampRoles(request.campId, ['SYSTEM_ADMIN'], {
        type: 'ADMISSION_REQUEST_AI_REVIEWED',
        title: 'Sugerencia de IA generada (sin aprobacion automatica)',
        message: `La solicitud ${request.id} tiene sugerencias de IA disponibles. Un administrador debe decidir manualmente.`,
        sourceType: 'admission_request',
        sourceId: request.id,
      });

      return;
    }

    if (request.status === 'REJECTED') {
      await this.notificationService.notifyCampRoles(request.campId, ['SYSTEM_ADMIN'], {
        type: 'ADMISSION_REQUEST_REJECTED',
        title: 'Solicitud rechazada por evaluacion IA',
        message: `La solicitud ${request.id} fue rechazada durante la evaluacion automatizada.`,
        sourceType: 'admission_request',
        sourceId: request.id,
      });

      await this.notificationService.queueEmail({
        toEmail: request.email,
        subject: 'Solicitud rechazada',
        templateKey: 'admission_request_rejected',
        payload: {
          title: 'Solicitud rechazada',
          message: `Hola ${applicantName}, la evaluacion inicial de tu solicitud resulto en rechazo. Puedes contactar al campamento para mas informacion.`,
          sourceType: 'admission_request',
        },
      });
    }
  }

  private async notifyAdminReviewResult(
    request: AdmissionRequest,
    approved: boolean,
    createdAccess: CreatedAccessContext | null,
  ): Promise<void> {
    const applicantName = this.buildApplicantName(request);

    await this.notificationService.notifyCampRoles(request.campId, ['SYSTEM_ADMIN'], {
      type: approved ? 'ADMISSION_REQUEST_APPROVED' : 'ADMISSION_REQUEST_REJECTED',
      title: approved ? 'Solicitud de admision aprobada' : 'Solicitud de admision rechazada',
      message: approved
        ? `La solicitud ${request.id} fue aprobada por administracion.`
        : `La solicitud ${request.id} fue rechazada por administracion.`,
      sourceType: 'admission_request',
      sourceId: request.id,
    });

    const approvedMessage = createdAccess
      ? `Tu solicitud de ingreso fue aprobada. Credenciales temporales: usuario ${createdAccess.username}, contrasena ${createdAccess.generatedPassword ?? 'ASIGNADA_PREVIAMENTE'}. Rol del sistema: ${createdAccess.role}. Oficio: ${createdAccess.occupationName}.`
      : 'Tu solicitud de ingreso fue aprobada por administracion.';

    await this.notificationService.queueEmail({
      toEmail: request.email,
      subject: approved ? 'Solicitud aprobada' : 'Solicitud rechazada',
      templateKey: approved ? 'admission_request_approved' : 'admission_request_rejected',
      payload: {
        title: approved ? 'Solicitud aprobada' : 'Solicitud rechazada',
        message: approved
          ? approvedMessage
          : 'Tu solicitud de ingreso fue rechazada por administracion.',
        sourceType: 'admission_request',
        details: approved
          ? {
            nombreSolicitante: applicantName,
            usuarioAsignado: createdAccess?.username ?? request.desiredUsername,
            contrasenaTemporal: createdAccess?.generatedPassword ?? 'NO_GENERADA',
            rolSistema: createdAccess?.role ?? 'NO_ASIGNADO',
            oficioAsignado: createdAccess?.occupationName ?? 'NO_ASIGNADO',
            descripcionOficio: createdAccess?.occupationDescription ?? 'Sin descripcion',
          }
          : {
            nombreSolicitante: applicantName,
            motivoRechazo: request.rejectionReason ?? 'Sin motivo especifico',
          },
      },
    });
  }

  private buildApplicantName(request: AdmissionRequest): string {
    return [request.name, request.lastName1, request.lastName2 ?? '']
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join(' ');
  }

  private generateTemporaryPassword(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$%';
    const bytes = randomBytes(14);
    let generated = '';

    for (let index = 0; index < bytes.length; index += 1) {
      const value = bytes[index] ?? 0;
      generated += alphabet[value % alphabet.length];
    }

    return generated;
  }

  private buildUsernameCandidate(desiredUsername: string, email: string): string {
    const fromDesired = desiredUsername
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '');

    if (fromDesired.length >= 4) {
      return fromDesired;
    }

    const fromEmail = email
      .split('@')[0]
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '');

    if (fromEmail && fromEmail.length >= 4) {
      return fromEmail;
    }

    return `user${Date.now()}`;
  }

  private async resolveAvailableUsername(baseCandidate: string, campId: number): Promise<string> {
    const userRepo = this.dataSource.getRepository(UserEntity);
    let candidate = baseCandidate;
    let suffix = 1;

    while (true) {
      const existing = await userRepo.findOne({
        where: {
          campId,
          username: candidate,
        },
        select: {
          id: true,
        },
      });

      if (!existing) {
        return candidate;
      }

      candidate = `${baseCandidate}${suffix}`;
      suffix += 1;
    }
  }

  private async createPersonAndUserForApprovedRequest(
    request: AdmissionRequest,
    assignedOccupationId: number,
    assignedRole: SystemRole,
  ): Promise<CreatedAccessContext> {
    const occupationRepo = this.dataSource.getRepository(OccupationEntity);
    const personRepo = this.dataSource.getRepository(PersonEntity);
    const userRepo = this.dataSource.getRepository(UserEntity);

    const occupation = await occupationRepo.findOne({ where: { id: assignedOccupationId } });
    if (!occupation) {
      throw new Error('No se encontro el oficio asignado para crear el acceso del usuario');
    }

    const existingPerson = await personRepo.findOne({
      where: {
        admissionRequestId: request.id,
      },
    });

    const person =
      existingPerson ??
      (await personRepo.save(
        personRepo.create({
          admissionRequestId: request.id,
          name: request.name,
          lastName1: request.lastName1,
          lastName2: request.lastName2,
          identificationNumber: `ADM-${request.id}`,
          birthDate: request.birthDate,
          gender: request.gender,
          initialHealthLevel: request.declaredHealthLevel,
          previousExperience: request.previousExperience,
          physicalConditionAtEntry: request.physicalCondition,
          currentStatus: 'ACTIVE',
          imageUrl: request.photoUrl,
          campId: request.campId,
          occupationId: assignedOccupationId,
        }),
      ));

    const role = assignedRole;

    const existingUser = await userRepo.findOne({
      where: {
        requestId: request.id,
      },
    });

    if (existingUser) {
      if (
        existingUser.role !== role ||
        existingUser.username !== request.desiredUsername ||
        existingUser.personId !== person.id ||
        existingUser.email !== request.email ||
        existingUser.campId !== request.campId
      ) {
        const availableUsername = await this.resolveAvailableUsername(
          this.buildUsernameCandidate(request.desiredUsername, request.email),
          request.campId,
        );

        existingUser.personId = person.id;
        existingUser.requestId = request.id;
        existingUser.campId = request.campId;
        existingUser.status = 'ACTIVE';
        existingUser.role = role;
        existingUser.username = availableUsername;
        existingUser.email = request.email;
        await userRepo.save(existingUser);

        return {
          username: availableUsername,
          generatedPassword: null,
          role,
          occupationName: occupation.name,
          occupationDescription: occupation.description ?? 'Sin descripcion disponible',
        };
      }

      return {
        username: existingUser.username,
        generatedPassword: null,
        role,
        occupationName: occupation.name,
        occupationDescription: occupation.description ?? 'Sin descripcion disponible',
      };
    }

    const baseUsername = this.buildUsernameCandidate(request.desiredUsername, request.email);
    const username = await this.resolveAvailableUsername(baseUsername, request.campId);
    const generatedPassword = this.generateTemporaryPassword();
    const passwordHash = await EncryptionService.hashPassword(generatedPassword);

    await userRepo.save(
      userRepo.create({
        personId: person.id,
        requestId: request.id,
        username,
        passwordHash,
        email: request.email,
        role,
        status: 'ACTIVE',
        campId: request.campId,
      }),
    );

    return {
      username,
      generatedPassword,
      role,
      occupationName: occupation.name,
      occupationDescription: occupation.description ?? 'Sin descripcion disponible',
    };
  }

  async uploadAdmissionRequestPhoto(
    id: number,
    file: Express.Multer.File,
  ): Promise<AdmissionRequest> {
    const existing = await this.repository.findById(id);
    if (!existing) throw new Error('Admission request not found');

    if (existing.photoUrl) {
      try {
        await this.storageService.deleteImage(existing.photoUrl);
      } catch (error) {
        this.logger.warn(
          `Failed to delete previous image for admission request ${id}: ${error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }

    const filePath = await this.storageService.uploadImage(file, 'admission-photos');
    const updated = await this.repository.update(id, { photoUrl: filePath });
    if (!updated) throw new Error('Admission request not found');
    return updated;
  }

  private async addSignedUrlToAdmissionRequest(
    request: AdmissionRequest,
  ): Promise<AdmissionRequest & { photoSignedUrl?: string }> {
    const result: AdmissionRequest & { photoSignedUrl?: string } = { ...request };
    if (request.photoUrl) {
      try {
        result.photoSignedUrl = await this.storageService.getSignedUrl(request.photoUrl);
      } catch (error) {
        this.logger.debug(
          `Failed to generate signed URL for admission request ${request.id}: ${error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }
    return result;
  }

  async getAdmissionRequestWithSignedUrl(
    id: number,
  ): Promise<(AdmissionRequest & { photoSignedUrl?: string }) | null> {
    const request = await this.getRequestById(id);
    if (!request) return null;
    return await this.addSignedUrlToAdmissionRequest(request);
  }

  async getAllAdmissionRequestsWithSignedUrls(filters?: {
    campId?: number;
    status?: AdmissionRequestStatus;
    page?: number;
    limit?: number;
  }): Promise<{ data: (AdmissionRequest & { photoSignedUrl?: string })[]; total: number }> {
    const result = await this.getAllRequests(filters);
    const dataWithUrls = await Promise.all(
      result.data.map((request) => this.addSignedUrlToAdmissionRequest(request)),
    );
    return { data: dataWithUrls, total: result.total };
  }
}
