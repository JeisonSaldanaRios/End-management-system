import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';

import { OccupationCoverageService } from './occupationCoverage.service';
import { NotificationService } from '../notification/notification.service';
import { TemporaryOccupationAssignmentEntity } from '../temporaryOccupationAssignment/temporaryOccupationAssignment.entity';
import { PersonEntity } from '../person/person.entity';
import { SystemTimeService } from '../systemTime/systemTime.service';

@Injectable()
export class OccupationCoverageScheduler {
  private readonly logger = new Logger(OccupationCoverageScheduler.name);

  constructor(
    private readonly coverageService: OccupationCoverageService,
    private readonly dataSource: DataSource,
    private readonly notificationService: NotificationService,
    private readonly systemTimeService: SystemTimeService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async checkCriticalOccupations(): Promise<void> {
    try {
      this.logger.debug('Starting critical occupation check...');

      const camps = await this.dataSource.query(`
        SELECT DISTINCT c.id
        FROM camp c
        WHERE c.status = 'ACTIVE'
      `);

      for (const camp of camps) {
        const campId = camp.id;
        const criticalOccupations = await this.coverageService.getCriticalOccupations(campId);

        for (const occupation of criticalOccupations) {
          if (!occupation.isCritical) {
            continue;
          }

          this.logger.warn(
            `Critical: Occupation "${occupation.occupationName}" in camp ${campId} has NO available workers!`,
          );

          const suggestions = await this.coverageService.getSuggestedReplacements(
            occupation.occupationId,
            campId,
          );

          if (suggestions.length > 0) {
            const topSuggestion = suggestions[0];
            if (!topSuggestion) {
              continue;
            }

            this.logger.log(
              `Auto-assigning ${topSuggestion.personName} to ${occupation.occupationName}`,
            );

            const systemAdmin = await this.dataSource.query(
              `
                SELECT u.id
                FROM public.system_user u
                WHERE u.role = 'SYSTEM_ADMIN'
                AND u.status = 'ACTIVE'
                AND u.camp_id = $1
                LIMIT 1
              `,
              [campId],
            );

            if (systemAdmin.length > 0) {
              const assignmentRepository = this.dataSource.getRepository(
                TemporaryOccupationAssignmentEntity,
              );

              const created = await assignmentRepository.save(
                assignmentRepository.create({
                  personId: topSuggestion.personId,
                  temporaryOccupationId: occupation.occupationId,
                  assignedBy: systemAdmin[0].id,
                  startDate: this.systemTimeService.now(),
                  endDate: null,
                  reason: 'Cobertura automatica por deficit critico',
                }),
              );

              const person = await this.dataSource
                .getRepository(PersonEntity)
                .findOne({ where: { id: topSuggestion.personId } });

              const personLabel = person
                ? `${person.name} ${person.lastName1}`
                : topSuggestion.personName;

              await this.notificationService.notifyCampRoles(campId, ['SYSTEM_ADMIN'], {
                type: 'TEMPORARY_OCCUPATION_ASSIGNED',
                title: 'Cobertura automatica de ocupacion',
                message: `${personLabel} fue asignado temporalmente a ${occupation.occupationName} para cubrir deficit critico.`,
                sourceType: 'temporary_occupation_assignment',
                sourceId: created.id,
              });
            }
          } else {
            await this.notificationService.notifyCampRoles(campId, ['SYSTEM_ADMIN'], {
              type: 'OCCUPATION_WITHOUT_STAFF',
              title: 'Ocupacion sin cobertura',
              message: `La ocupacion "${occupation.occupationName}" no tiene trabajadores disponibles y no hay sugerencias de reemplazo.`,
              sourceType: 'occupation',
              sourceId: occupation.occupationId,
            });
          }
        }
      }

      this.logger.debug('Critical occupation check completed');
    } catch (error) {
      this.logger.error('Error during critical occupation check:', error);
    }
  }
}
