import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, In, MoreThanOrEqual, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { AchievementRepository } from './achievement.repository';
import { CampAchievementService } from '../campAchievement/campAchievement.service';
import { CampRepository } from '../camp/camp.repository';
import { Achievement } from './achievement.model';
import { PersonEntity } from '../person/person.entity';
import { ExpeditionEntity } from '../expedition/expedition.entity';
import { IntercampRequestEntity } from '../intercampRequest/intercampRequest.entity';
import { InventoryAlertEntity } from '../inventoryAlert/inventoryAlert.entity';
import { InventoryMovementEntity } from '../inventoryMovement/inventoryMovement.entity';
import { NotificationEntity } from '../notification/notification.entity';
import { SystemTimeService } from '../systemTime/systemTime.service';

@Injectable()
export class AchievementEvaluatorService {
  private readonly logger = new Logger(AchievementEvaluatorService.name);

  constructor(
    private readonly achievementRepo: AchievementRepository,
    private readonly campRepo: CampRepository,
    private readonly campAchievementService: CampAchievementService,
    private readonly dataSource: DataSource,
    @InjectRepository(PersonEntity)
    private readonly personRepo: Repository<PersonEntity>,
    @InjectRepository(ExpeditionEntity)
    private readonly expeditionRepo: Repository<ExpeditionEntity>,
    @InjectRepository(IntercampRequestEntity)
    private readonly intercampRepo: Repository<IntercampRequestEntity>,
    @InjectRepository(InventoryAlertEntity)
    private readonly inventoryAlertRepo: Repository<InventoryAlertEntity>,
    @InjectRepository(InventoryMovementEntity)
    private readonly inventoryMovementRepo: Repository<InventoryMovementEntity>,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepo: Repository<NotificationEntity>,
    private readonly systemTimeService: SystemTimeService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async processAchievements() {
    this.logger.log('Starting achievement evaluation process...');
    try {
      const achievementsResult = await this.achievementRepo.findAllAndCount({ limit: 1000 });
      const activeAchievements = achievementsResult.data.filter((a) => a.isActive);

      const campsResult = await this.campRepo.findAllAndCount({ limit: 1000 });

      for (const camp of campsResult.data) {
        for (const achievement of activeAchievements) {
          try {
            await this.evaluateAchievement(camp.id, achievement);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Error evaluating achievement ${achievement.name} for camp ${camp.id}: ${message}`,
            );
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to process achievements: ${message}`);
    }
    this.logger.log('Achievement evaluation process completed.');
  }

  private async evaluateAchievement(campId: number, achievement: Achievement) {
    const existing = await this.campAchievementService.getCampAchievementByKey(
      campId,
      achievement.id,
    );
    if (existing) return;

    const metricValue = await this.calculateMetric(campId, achievement);

    if (this.compare(metricValue, achievement.operator, achievement.targetValue)) {
      await this.campAchievementService.createCampAchievement({
        campId,
        achievementId: achievement.id,
        unlockedAt: this.systemTimeService.now(),
        progressSnapshot: metricValue,
        unlockContext: `Metric ${achievement.metricKey} reached ${metricValue} (target: ${achievement.targetValue})`,
      });
      this.logger.log(`Achievement "${achievement.name}" unlocked for camp ${campId}!`);
    }
  }

  private compare(value: number, operator: string, target: number): boolean {
    switch (operator) {
      case '>=':
        return value >= target;
      case '>':
        return value > target;
      case '<=':
        return value <= target;
      case '<':
        return value < target;
      case '==':
        return value === target;
      default:
        return false;
    }
  }

  private async calculateMetric(campId: number, achievement: Achievement): Promise<number> {
    const { metricKey, windowDays } = achievement;

    switch (metricKey) {
      case 'population.active':
        return await this.personRepo.count({
          where: { campId, currentStatus: In(['ACTIVE', 'SICK', 'INJURED', 'ON_EXPEDITION']) },
        });

      case 'population.zero_injured_days':
        return await this.getMetricZeroInjuredDays(campId, windowDays || 7);

      case 'expeditions.completed':
        return await this.expeditionRepo.count({
          where: { campId, status: 'COMPLETED' },
        });

      case 'expeditions.success_rate':
        return await this.getMetricExpeditionsSuccessRate(campId, windowDays || 30);

      case 'intercamp.requests_approved':
        return await this.intercampRepo.count({
          where: { originCampId: campId, status: 'APPROVED' },
        });

      case 'intercamp.response_time_fast_rate':
        return await this.getMetricIntercampResponseTimeRate(campId, 24, windowDays || 30);

      case 'inventory.no_critical_alerts_days':
        return await this.getMetricNoCriticalAlertsDays(campId, windowDays || 7);

      case 'inventory.inbound_movements_count':
        return await this.getMetricInboundMovements(campId, windowDays || 14);

      case 'stability.no_critical_notifications_days':
        return await this.getMetricNoCriticalNotificationsDays(campId, windowDays || 14);

      case 'stability.continuous_operational_days':
        return await this.getMetricContinuousOperationalDays(campId);

      default:
        return 0;
    }
  }

  private async getMetricZeroInjuredDays(campId: number, days: number): Promise<number> {
    const startDate = this.systemTimeService.now();
    startDate.setDate(startDate.getDate() - days);

    const injuredHistory = await this.dataSource.query(
      `
      SELECT COUNT(*) as count
      FROM person_status_history h
      JOIN person p ON p.id = h.person_id
      WHERE p.camp_id = $1
        AND h.new_status = 'INJURED'
        AND h.change_date >= $2
    `,
      [campId, startDate],
    );

    const count = parseInt(injuredHistory[0].count, 10);
    return count === 0 ? days : 0;
  }

  private async getMetricExpeditionsSuccessRate(campId: number, days: number): Promise<number> {
    const startDate = this.systemTimeService.now();
    startDate.setDate(startDate.getDate() - days);

    const stats = await this.expeditionRepo
      .createQueryBuilder('e')
      .select('e.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('e.camp_id = :campId', { campId })
      .andWhere('e.created_at >= :startDate', { startDate })
      .andWhere("e.status IN ('COMPLETED', 'LOST')")
      .groupBy('e.status')
      .getRawMany();

    const completed = parseInt(stats.find((s) => s.status === 'COMPLETED')?.count || '0', 10);
    const lost = parseInt(stats.find((s) => s.status === 'LOST')?.count || '0', 10);
    const total = completed + lost;

    return total === 0 ? 0 : completed / total;
  }

  private async getMetricIntercampResponseTimeRate(
    campId: number,
    hours: number,
    windowDays: number,
  ): Promise<number> {
    const startDate = this.systemTimeService.now();
    startDate.setDate(startDate.getDate() - windowDays);

    const rows = await this.intercampRepo
      .createQueryBuilder('r')
      .where('r.destination_camp_id = :campId', { campId })
      .andWhere('r.created_date >= :startDate', { startDate })
      .andWhere('r.response_date IS NOT NULL')
      .getMany();

    if (rows.length === 0) return 0;

    const fastResponses = rows.filter((r) => {
      if (!r.responseDate) return false;
      const diff = r.responseDate.getTime() - r.createdDate.getTime();
      return diff <= hours * 60 * 60 * 1000;
    });

    return fastResponses.length / rows.length;
  }

  private async getMetricNoCriticalAlertsDays(campId: number, days: number): Promise<number> {
    const startDate = this.systemTimeService.now();
    startDate.setDate(startDate.getDate() - days);

    const count = await this.inventoryAlertRepo.count({
      where: {
        campId,
        alertDate: MoreThanOrEqual(startDate),
      },
    });
    return count === 0 ? days : 0;
  }

  private async getMetricInboundMovements(campId: number, days: number): Promise<number> {
    const startDate = this.systemTimeService.now();
    startDate.setDate(startDate.getDate() - days);

    return await this.inventoryMovementRepo
      .createQueryBuilder('m')
      .where('m.camp_id = :campId', { campId })
      .andWhere('m.date >= :startDate', { startDate })
      .andWhere("m.movement_type IN ('DAILY_COLLECTION', 'TRANSFER_RECEIVED', 'MANUAL_ADJUSTMENT')")
      .andWhere('m.amount > 0')
      .getCount();
  }

  private async getMetricNoCriticalNotificationsDays(campId: number, days: number): Promise<number> {
    const startDate = this.systemTimeService.now();
    startDate.setDate(startDate.getDate() - days);

    const count = await this.notificationRepo
      .createQueryBuilder('n')
      .where('n.camp_id = :campId', { campId })
      .andWhere('n.created_date >= :startDate', { startDate })
      .andWhere("(n.type LIKE '%CRITICAL%' OR n.title LIKE '%CRITICAL%')")
      .getCount();

    return count === 0 ? days : 0;
  }

  private async getMetricContinuousOperationalDays(campId: number): Promise<number> {
    const lastCritical = await this.inventoryAlertRepo.findOne({
      where: { campId },
      order: { alertDate: 'DESC' },
    });

    const start = lastCritical ? lastCritical.alertDate : new Date(2020, 0, 1);
    const diff = this.systemTimeService.now().getTime() - start.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }
}
