import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';

import { CampEntity } from '../camp/camp.entity';
import { CampInventoryEntity } from '../campInventory/campInventory.entity';
import { DailyCollectionRecordEntity } from '../dailyCollectionRecord/dailyCollectionRecord.entity';
import { DailyConsumptionEntity } from '../dailyConsumption/dailyConsumption.entity';
import { ExpeditionEntity } from '../expedition/expedition.entity';
import { ExpeditionRepository } from '../expedition/expedition.repository';
import { ExpeditionParticipantEntity } from '../expeditionParticipant/expeditionParticipant.entity';
import { ExpeditionParticipantRepository } from '../expeditionParticipant/expeditionParticipant.repository';
import { InventoryAlertEntity } from '../inventoryAlert/inventoryAlert.entity';
import { InventoryMovementEntity } from '../inventoryMovement/inventoryMovement.entity';
import { NotificationService } from '../notification/notification.service';
import type { NotificationType } from '../notification/notification.model';
import { PersonEntity } from '../person/person.entity';
import { SystemTimeService } from '../systemTime/systemTime.service';
import { TemporalAutomationRepository } from './temporalAutomation.repository';
import { TransferEntity } from '../transfer/transfer.entity';
import { TransferService } from '../transfer/transfer.service';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class TemporalAutomationService {
  private readonly logger = new Logger(TemporalAutomationService.name);

  constructor(
    @InjectRepository(CampEntity)
    private readonly campInventoryRepo: Repository<CampInventoryEntity>,
    @InjectRepository(DailyCollectionRecordEntity)
    private readonly dailyCollectionRecordRepo: Repository<DailyCollectionRecordEntity>,
    @InjectRepository(DailyConsumptionEntity)
    private readonly dailyConsumptionRepo: Repository<DailyConsumptionEntity>,
    @InjectRepository(ExpeditionEntity)
    private readonly expeditionRepo: Repository<ExpeditionEntity>,
    @InjectRepository(ExpeditionParticipantEntity)
    private readonly expeditionParticipantRepo: Repository<ExpeditionParticipantEntity>,
    private readonly expeditionParticipantRepository: ExpeditionParticipantRepository,
    private readonly expeditionRepository: ExpeditionRepository,
    @InjectRepository(InventoryAlertEntity)
    private readonly inventoryAlertRepo: Repository<InventoryAlertEntity>,
    @InjectRepository(InventoryMovementEntity)
    private readonly inventoryMovementRepo: Repository<InventoryMovementEntity>,
    private readonly temporalAutomationRepository: TemporalAutomationRepository,
    private readonly notificationService: NotificationService,
    private readonly systemTimeService: SystemTimeService,
    @InjectRepository(TransferEntity)
    private readonly transferRepo?: Repository<TransferEntity>,
    private readonly transferService?: TransferService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runDailyResourceCycle(): Promise<void> {
    const now = this.systemTimeService.now();
    const camps = await this.temporalAutomationRepository.findDailyCycleCamps();

    const foodResource = await this.temporalAutomationRepository.findResourceTypeByCategory('FOOD');
    const waterResource =
      await this.temporalAutomationRepository.findResourceTypeByCategory('WATER');

    if (!foodResource || !waterResource) {
      this.logger.warn('No FOOD/WATER resources were found for the daily cycle');
      return;
    }

    for (const camp of camps) {
      const touchedResourceIds = new Set<number>();
      const rationPerPerson = this.toDecimal(camp.minimumDailyRationPerPerson || '1.00');
      const recorderUserId = await this.temporalAutomationRepository.findAutomationRecorderUserId(
        camp.id,
      );

      if (recorderUserId === null) {
        this.logger.warn(
          `Skipping inventory movements for camp ${camp.id}: no ACTIVE system user available to record automation`,
        );
      }

      const peopleCount = await this.temporalAutomationRepository.countCampOperationalPeople(
        camp.id,
      );

      const totalRation = this.roundTo2(peopleCount * rationPerPerson);

      await this.createDailyCollectionRecords(camp.id, now);

      await this.applyDailyConsumption(
        camp.id,
        foodResource.id,
        totalRation,
        now,
        touchedResourceIds,
        recorderUserId,
      );
      await this.applyDailyConsumption(
        camp.id,
        waterResource.id,
        totalRation,
        now,
        touchedResourceIds,
        recorderUserId,
      );

      const productionByResource = await this.getProductionByResource(camp.id, now);

      for (const [resourceTypeId, amount] of productionByResource.entries()) {
        if (amount <= 0) {
          continue;
        }

        const inventory = await this.getOrCreateCampInventory(camp.id, resourceTypeId);
        const currentAmount = this.toDecimal(inventory.currentAmount);
        inventory.currentAmount = this.roundTo2(currentAmount + amount).toFixed(2);
        inventory.lastUpdate = now;
        await this.campInventoryRepo.save(inventory);

        if (recorderUserId !== null) {
          await this.inventoryMovementRepo.save(
            this.inventoryMovementRepo.create({
              campId: camp.id,
              resourceTypeId,
              amount: amount.toFixed(2),
              movementType: 'DAILY_COLLECTION',
              sourceId: null,
              sourceType: 'temporal_automation',
              recordedBy: recorderUserId,
              date: now,
              description: 'Automatic daily production',
            }),
          );
        }

        touchedResourceIds.add(resourceTypeId);
      }

      await this.generateAlertsIfNeeded(camp.id, [...touchedResourceIds], now);
      await this.notifyCampOverpopulationIfNeeded(camp, peopleCount);
      await this.notifyOccupationsWithoutStaff(camp.id);
    }
  }

  private toCalendarDate(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private async createDailyCollectionRecords(campId: number, now: Date): Promise<void> {
    const recorderUserId =
      await this.temporalAutomationRepository.findAutomationRecorderUserId(campId);

    if (recorderUserId === null) {
      this.logger.warn(
        `Skipping daily collection records for camp ${campId}: no ACTIVE system user available to record automation`,
      );
      return;
    }

    const rows = await this.temporalAutomationRepository.findDailyCollectionRows(
      campId,
      now.toISOString(),
    );

    if (rows.length === 0) {
      return;
    }

    const recordDate = this.toCalendarDate(now);

    for (const row of rows) {
      const existing = await this.dailyCollectionRecordRepo.findOne({
        where: {
          campId,
          personId: row.personId,
          resourceTypeId: row.resourceTypeId,
          date: recordDate,
        },
      });

      if (existing) {
        continue;
      }

      const movement = await this.inventoryMovementRepo.save(
        this.inventoryMovementRepo.create({
          campId,
          resourceTypeId: row.resourceTypeId,
          amount: row.expectedAmount,
          movementType: 'DAILY_COLLECTION',
          sourceId: null,
          sourceType: 'temporal_automation',
          recordedBy: recorderUserId,
          date: now,
          description: 'Automatic daily collection',
        }),
      );

      await this.dailyCollectionRecordRepo.save(
        this.dailyCollectionRecordRepo.create({
          campId,
          personId: row.personId,
          resourceTypeId: row.resourceTypeId,
          date: recordDate,
          expectedAmount: row.expectedAmount,
          actualAmount: row.expectedAmount,
          differenceReason: null,
          recordedBy: recorderUserId,
          movementId: movement.id,
        }),
      );
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async runHourlyExpeditionStateUpdate(): Promise<void> {
    const now = this.systemTimeService.now();
    const expeditions = await this.temporalAutomationRepository.findExpeditionsForAutoStateUpdate();

    if (expeditions.length === 0) {
      return;
    }

    for (const expedition of expeditions) {
      const departure = expedition.plannedDepartureDate;
      const estimatedReturn = expedition.plannedReturnDate;
      const lossLimit = new Date(
        estimatedReturn.getTime() + Math.max(0, expedition.extraDaysAvailable) * MS_PER_DAY,
      );

      let nextStatus = expedition.status;

      if (expedition.actualReturnDate) {
        nextStatus =
          expedition.status === 'RETURNED_AFTER_LOST' ? 'RETURNED_AFTER_LOST' : 'COMPLETED';
      } else if (now.getTime() > lossLimit.getTime()) {
        nextStatus = 'LOST';
      } else if (now.getTime() > estimatedReturn.getTime()) {
        nextStatus = 'DELAYED';
      } else if (now.getTime() >= departure.getTime()) {
        nextStatus = 'IN_PROGRESS';
      } else {
        nextStatus = 'PLANNED';
      }

      const extraDaysUsed =
        now.getTime() > estimatedReturn.getTime()
          ? Math.max(0, Math.ceil((now.getTime() - estimatedReturn.getTime()) / MS_PER_DAY))
          : 0;

      if (nextStatus !== expedition.status || extraDaysUsed !== expedition.extraDaysUsed) {
        const previousStatus = expedition.status;
        expedition.status = nextStatus;
        expedition.extraDaysUsed = Math.min(extraDaysUsed, expedition.extraDaysAvailable);
        await this.expeditionRepo.save(expedition);

        if (previousStatus !== 'IN_PROGRESS' && expedition.status === 'IN_PROGRESS') {
          await this.expeditionRepository.applyDepartureProvisioningIfNeeded(expedition.id, now);
        }

        await this.syncParticipantPersonStatuses(expedition.id);

        if (previousStatus !== expedition.status) {
          await this.notifyExpeditionStatusChange(expedition, previousStatus);
        }
      }
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async runDueTransferExecutions(): Promise<void> {
    const now = this.systemTimeService.now();
    if (!this.transferService || !this.transferRepo) return;

    const dueDepartureTransfers = await this.transferRepo.find({
      where: {
        status: 'PENDING_DEPARTURE',
        plannedDepartureDate: LessThanOrEqual(now),
      },
      order: {
        plannedDepartureDate: 'ASC',
        id: 'ASC',
      },
    });

    for (const transfer of dueDepartureTransfers) {
      try {
        await this.transferService.updateTransfer(transfer.id, {
          status: 'IN_TRANSIT',
          actualDepartureDate: now,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(
          `No se pudo ejecutar automaticamente el traslado ${transfer.id}: ${message}`,
        );

        try {
          await this.transferService.updateTransfer(transfer.id, { status: 'CANCELED' });
        } catch (cancelErr) {
          this.logger.warn(
            `Falló al cancelar automáticamente el traslado ${transfer.id}: ${
              cancelErr instanceof Error ? cancelErr.message : 'unknown error'
            }`,
          );
        }

        try {
          const rows = (await this.transferRepo.query(
            `SELECT r.origin_camp_id AS origin, r.destination_camp_id AS destination
             FROM public.transfer t
             JOIN public.intercamp_request r ON r.id = t.request_id
             WHERE t.id = $1 LIMIT 1`,
            [transfer.id],
          )) as Array<{ origin: number; destination: number }>;

          const originCampId = rows[0]?.origin ?? null;
          const destinationCampId = rows[0]?.destination ?? null;

          const notif: {
            type: NotificationType;
            title: string;
            message: string;
            sourceType: string;
            sourceId: number;
          } = {
            type: 'TRANSFER_EXECUTION_FAILED',
            title: 'Ejecución de traslado fallida',
            message: `El traslado #${transfer.id} no pudo ejecutarse automaticamente: ${message}`,
            sourceType: 'transfer',
            sourceId: transfer.id,
          };

          if (originCampId !== null) {
            await this.notificationService.notifyCampRoles(
              originCampId,
              ['SYSTEM_ADMIN', 'RESOURCE_MANAGEMENT', 'TRAVEL_MANAGER'],
              notif,
            );
          }

          if (destinationCampId !== null) {
            await this.notificationService.notifyCampRoles(
              destinationCampId,
              ['SYSTEM_ADMIN', 'RESOURCE_MANAGEMENT', 'TRAVEL_MANAGER'],
              notif,
            );
          }
        } catch (notifyErr) {
          this.logger.warn(
            `Error al notificar fracaso de ejecucion para traslado ${transfer.id}: ${
              notifyErr instanceof Error ? notifyErr.message : 'unknown error'
            }`,
          );
        }
      }
    }

    const dueArrivalTransfers = await this.transferRepo.find({
      where: {
        status: 'IN_TRANSIT',
        plannedArrivalDate: LessThanOrEqual(now),
      },
      order: {
        plannedArrivalDate: 'ASC',
        id: 'ASC',
      },
    });

    for (const transfer of dueArrivalTransfers) {
      try {
        await this.transferService.updateTransfer(transfer.id, {
          status: 'COMPLETED',
          actualArrivalDate: now,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(
          `No se pudo completar automaticamente el traslado ${transfer.id}: ${message}`,
        );
      }
    }
  }

  private async applyDailyConsumption(
    campId: number,
    resourceTypeId: number,
    totalRation: number,
    now: Date,
    touchedResourceIds: Set<number>,
    recorderUserId: number | null,
  ): Promise<void> {
    const inventory = await this.getOrCreateCampInventory(campId, resourceTypeId);
    const currentAmount = this.toDecimal(inventory.currentAmount);
    const newAmount = this.roundTo2(currentAmount - totalRation);

    inventory.currentAmount = newAmount.toFixed(2);
    inventory.lastUpdate = now;
    await this.campInventoryRepo.save(inventory);

    await this.dailyConsumptionRepo.save(
      this.dailyConsumptionRepo.create({
        fecha: now,
        campamentoId: campId,
        recursoId: resourceTypeId,
        cantidad: totalRation.toFixed(2),
        tipo: 'consumo_racion',
      }),
    );

    if (recorderUserId !== null) {
      await this.inventoryMovementRepo.save(
        this.inventoryMovementRepo.create({
          campId,
          resourceTypeId,
          amount: (-totalRation).toFixed(2),
          movementType: 'DAILY_RATION',
          sourceId: null,
          sourceType: 'temporal_automation',
          recordedBy: recorderUserId,
          date: now,
          description: 'Automatic daily consumption',
        }),
      );
    }

    touchedResourceIds.add(resourceTypeId);
  }

  private async getOrCreateCampInventory(
    campId: number,
    resourceTypeId: number,
  ): Promise<CampInventoryEntity> {
    return await this.temporalAutomationRepository.getOrCreateCampInventory(campId, resourceTypeId);
  }

  private async getProductionByResource(campId: number, now: Date): Promise<Map<number, number>> {
    const rows = await this.temporalAutomationRepository.findProductionOccupationRows(
      campId,
      now.toISOString(),
    );

    if (rows.length === 0) {
      return new Map<number, number>();
    }

    const occupationIds = [...new Set(rows.map((row) => Number(row.occupation_id)))];
    const occupations =
      await this.temporalAutomationRepository.findProductionOccupationsByIds(occupationIds);

    const occupationById = new Map(occupations.map((occupation) => [occupation.id, occupation]));
    const result = new Map<number, number>();

    for (const row of rows) {
      const occupation = occupationById.get(Number(row.occupation_id));
      if (!occupation || occupation.resourceTypeId === null) {
        continue;
      }

      const produced = this.toDecimal(occupation.dailyAmountProduced);
      if (produced <= 0) {
        continue;
      }

      const previous = result.get(occupation.resourceTypeId) ?? 0;
      result.set(occupation.resourceTypeId, this.roundTo2(previous + produced));
    }

    return result;
  }

  private async generateAlertsIfNeeded(
    campId: number,
    resourceTypeIds: number[],
    now: Date,
  ): Promise<void> {
    if (resourceTypeIds.length === 0) {
      return;
    }

    const inventories = await this.temporalAutomationRepository.findCampInventories(
      campId,
      resourceTypeIds,
    );

    for (const inventory of inventories) {
      const currentAmount = this.toDecimal(inventory.currentAmount);
      const minAlert = this.toDecimal(inventory.minimumAlertAmount);

      if (currentAmount >= minAlert) {
        continue;
      }

      const unresolved = await this.temporalAutomationRepository.findUnresolvedInventoryAlert(
        campId,
        inventory.resourceTypeId,
      );

      if (unresolved) {
        continue;
      }

      const createdAlert = await this.inventoryAlertRepo.save(
        this.inventoryAlertRepo.create({
          campId,
          resourceTypeId: inventory.resourceTypeId,
          amountAtAlertGeneration: currentAmount.toFixed(2),
          movementId: null,
          alertDate: now,
          resolved: false,
          resolutionDate: null,
          resolvedBy: null,
        }),
      );

      await this.notificationService.notifyCampRoles(
        campId,
        ['RESOURCE_MANAGEMENT', 'SYSTEM_ADMIN'],
        {
          type: 'INVENTORY_ALERT',
          title: 'Alerta de inventario bajo',
          message: `El recurso ${inventory.resourceTypeId} esta por debajo del minimo permitido (${inventory.currentAmount} < ${inventory.minimumAlertAmount}).`,
          sourceType: 'inventory_alert',
          sourceId: createdAlert.id,
        },
      );
    }
  }

  private async notifyCampOverpopulationIfNeeded(
    camp: Pick<CampEntity, 'id' | 'name' | 'maxPersonCapacity'>,
    peopleCount: number,
  ): Promise<void> {
    if (!Number.isInteger(camp.maxPersonCapacity) || camp.maxPersonCapacity <= 0) {
      return;
    }

    if (peopleCount <= camp.maxPersonCapacity) {
      return;
    }

    await this.notificationService.notifyCampRoles(camp.id, ['SYSTEM_ADMIN'], {
      type: 'OVERPOPULATION_ALERT',
      title: 'Alerta de sobrepoblacion',
      message: `El campamento ${camp.name} excedio su capacidad (${peopleCount}/${camp.maxPersonCapacity}).`,
      sourceType: 'camp',
      sourceId: camp.id,
    });
  }

  private async notifyOccupationsWithoutStaff(campId: number): Promise<void> {
    const relevantOccupations =
      await this.temporalAutomationRepository.findRelevantOccupationsForStaffing();

    if (relevantOccupations.length === 0) {
      return;
    }

    const occupationIds = relevantOccupations.map((occupation) => occupation.id);
    const activePeople = await this.temporalAutomationRepository.findActivePeopleOccupationIds(
      campId,
      occupationIds,
    );

    const staffedOccupationIds = new Set(
      activePeople
        .map((person) => person.occupationId)
        .filter((occupationId): occupationId is number => occupationId !== null),
    );

    for (const occupation of relevantOccupations) {
      if (staffedOccupationIds.has(occupation.id)) {
        continue;
      }

      await this.notificationService.notifyCampRoles(campId, ['SYSTEM_ADMIN'], {
        type: 'OCCUPATION_WITHOUT_STAFF',
        title: 'Ocupacion sin personal asignado',
        message: `La ocupacion ${occupation.name} no tiene personal activo asignado en el campamento.`,
        sourceType: 'occupation',
        sourceId: occupation.id,
      });
    }
  }

  private toDecimal(value: string | number): number {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private roundTo2(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private async syncParticipantPersonStatuses(expeditionId: number): Promise<void> {
    const personIds =
      await this.expeditionParticipantRepository.getActivePersonIdsByExpedition(expeditionId);
    if (personIds.length === 0) {
      return;
    }

    for (const personId of personIds) {
      await this.syncPersonStatusFromExpeditions(personId);
    }
  }

  private async syncPersonStatusFromExpeditions(personId: number): Promise<void> {
    const person = await this.temporalAutomationRepository.findPersonStatusById(personId);

    if (!person) {
      return;
    }

    const statuses = new Set(
      await this.expeditionParticipantRepository.getTrackedExpeditionStatusesByPersonId(personId),
    );
    let targetStatus: PersonEntity['currentStatus'] | null = null;

    if (statuses.has('LOST')) {
      targetStatus = 'OUTSIDE_CAMP';
    } else if (statuses.has('IN_PROGRESS') || statuses.has('DELAYED')) {
      targetStatus = 'ON_EXPEDITION';
    }

    if (targetStatus === null) {
      if (person.currentStatus === 'ON_EXPEDITION' || person.currentStatus === 'OUTSIDE_CAMP') {
        await this.temporalAutomationRepository.updatePersonStatus(person.id, 'ACTIVE');
      }
      return;
    }

    if (person.currentStatus === targetStatus) {
      return;
    }

    if (!['ACTIVE', 'ON_EXPEDITION', 'OUTSIDE_CAMP'].includes(person.currentStatus)) {
      return;
    }

    await this.temporalAutomationRepository.updatePersonStatus(person.id, targetStatus);
  }

  private async notifyExpeditionStatusChange(
    expedition: ExpeditionEntity,
    previousStatus: ExpeditionEntity['status'],
  ): Promise<void> {
    const message = `La expedicion ${expedition.name} cambio de estado de ${previousStatus} a ${expedition.status}.`;

    await this.notificationService.notifyCampRoles(
      expedition.campId,
      ['SYSTEM_ADMIN', 'RESOURCE_MANAGEMENT', 'TRAVEL_MANAGER'],
      {
        type: 'EXPEDITION_STATUS_UPDATED',
        title: 'Estado de expedicion actualizado',
        message,
        sourceType: 'expedition',
        sourceId: expedition.id,
      },
    );

    const personIds = await this.expeditionParticipantRepository.getActivePersonIdsByExpedition(
      expedition.id,
    );
    if (personIds.length === 0) {
      return;
    }

    const participantUserIds =
      await this.temporalAutomationRepository.findActiveUserIdsByCampAndPersonIds(
        expedition.campId,
        personIds,
      );

    if (participantUserIds.length === 0) {
      return;
    }

    await this.notificationService.notifyUsers(participantUserIds, {
      campId: expedition.campId,
      type: 'EXPEDITION_STATUS_UPDATED',
      title: 'Estado de expedicion actualizado',
      message: `Tu expedicion ${expedition.name} ahora esta en estado ${expedition.status}.`,
      sourceType: 'expedition',
      sourceId: expedition.id,
    });
  }
}
