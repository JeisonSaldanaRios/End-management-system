import { Controller, Get, Post, Body, BadRequestException, Logger, Inject } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBody,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { Roles } from '../../common/decorators/roles.decorator';
import { SystemTimeService } from './systemTime.service';
import { AdvanceSystemTimeDto, TimeUnit } from './dto/advance-system-time.dto';
import { SystemTimeOffsetResponseDto } from './dto/system-time-offset-response.dto';
import { TemporalAutomationService } from '../temporalAutomation/temporalAutomation.service';
import { ExpeditionService } from '../expedition/expedition.service';
import { NotificationService } from '../notification/notification.service';
import { ExpeditionEntity } from '../expedition/expedition.entity';
import { SessionEntity } from '../session/session.entity';
import { PasswordResetTokenEntity } from '../../auth/passwordResetToken.entity';

@Controller('system/time')
@ApiTags('System Time')
export class SystemTimeController {
  private readonly logger = new Logger(SystemTimeController.name);

  constructor(
    private readonly systemTimeService: SystemTimeService,
    private readonly moduleRef: ModuleRef,
    @InjectRepository(ExpeditionEntity)
    private readonly expeditionRepo: Repository<ExpeditionEntity>,
    @InjectRepository(SessionEntity)
    private readonly sessionRepo: Repository<SessionEntity>,
    @InjectRepository(PasswordResetTokenEntity)
    private readonly passwordResetTokenRepo: Repository<PasswordResetTokenEntity>,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get current server time' })
  @ApiOkResponse({ description: 'Current server time' })
  getServerTime() {
    return this.systemTimeService.getServerTime();
  }

  @Post('advance')
  @Roles('SYSTEM_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Advance system time (Admin only)',
    description:
      'Allows administrators to advance the system time by a specified amount in hours or minutes. This automatically triggers: daily resource cycles, expedition state updates, session expirations, and token invalidations.',
  })
  @ApiBody({ type: AdvanceSystemTimeDto })
  @ApiOkResponse({
    type: SystemTimeOffsetResponseDto,
    description: 'System time advanced successfully',
  })
  @ApiBadRequestResponse({
    description:
      'Invalid unit or amount. Unit must be "hours" or "minutes", and amount must be > 0',
  })
  @ApiForbiddenResponse({ description: 'Only administrators can access this endpoint' })
  async advanceSystemTime(@Body() dto: AdvanceSystemTimeDto): Promise<{
    success: boolean;
    data: SystemTimeOffsetResponseDto & { automations: string[] };
    message: string;
  }> {
    try {
      if (!dto.unit || !Object.values(TimeUnit).includes(dto.unit)) {
        throw new BadRequestException('Invalid unit. Must be either "hours" or "minutes"');
      }

      if (typeof dto.amount !== 'number' || dto.amount <= 0) {
        throw new BadRequestException('Invalid amount. Must be a positive number');
      }

      const offsetBefore = this.systemTimeService.getOffset();
      const oldSystemTime = this.systemTimeService.now();

      let milliseconds = 0;
      if (dto.unit === TimeUnit.HOURS) {
        milliseconds = dto.amount * 60 * 60 * 1000;
      } else if (dto.unit === TimeUnit.MINUTES) {
        milliseconds = dto.amount * 60 * 1000;
      }

      const result = this.systemTimeService.addOffset(milliseconds);
      const offsetAfter = this.systemTimeService.getOffset();
      const newSystemTime = this.systemTimeService.now();

      const message =
        dto.unit === TimeUnit.HOURS
          ? `Advanced system time by ${dto.amount} hour(s)`
          : `Advanced system time by ${dto.amount} minute(s)`;

      const automations: string[] = [];

      try {
        const automationPromise = this.executeTimeAutomations(oldSystemTime, newSystemTime);
        const timeoutPromise = new Promise<string[]>((resolve) => {
          setTimeout(() => resolve(['Automations execution timed out']), 5000);
        });
        const result = await Promise.race([automationPromise, timeoutPromise]);
        automations.push(...result);
      } catch (error) {
        this.logger.error('Error executing automations:', error);
        automations.push('Error executing automations (non-blocking)');
      }

      return {
        success: true,
        data: {
          offsetMilliseconds: offsetAfter,
          currentSystemTime: result.newTime,
          lastModifiedAt: newSystemTime.toISOString(),
          message,
          automations,
        },
        message: `System time successfully advanced by ${dto.amount} ${dto.unit}. Executed ${automations.length} automation(s).`,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error advancing system time',
      );
    }
  }

  @Get('offset')
  @Roles('SYSTEM_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current time offset (Admin only)',
    description: 'Retrieve the current cumulative time offset in milliseconds',
  })
  @ApiOkResponse({
    description: 'Current time offset',
    schema: {
      type: 'object',
      properties: {
        offsetMilliseconds: { type: 'number', example: 7200000 },
        currentSystemTime: { type: 'string', example: '2026-05-11T14:30:00.000Z' },
      },
    },
  })
  @ApiForbiddenResponse({ description: 'Only administrators can access this endpoint' })
  getOffset(): {
    success: boolean;
    data: { offsetMilliseconds: number; currentSystemTime: string };
  } {
    const offset = this.systemTimeService.getOffset();
    const currentTime = this.systemTimeService.now();

    return {
      success: true,
      data: {
        offsetMilliseconds: offset,
        currentSystemTime: currentTime.toISOString(),
      },
    };
  }

  private async executeTimeAutomations(oldTime: Date, newTime: Date): Promise<string[]> {
    const automations: string[] = [];

    const midnightsPassed = this.calculateMidnightsPassed(oldTime, newTime);
    if (midnightsPassed > 0) {
      await this.executeDailyCycles(midnightsPassed);
      automations.push(`Executed ${midnightsPassed} daily resource cycle(s)`);
    }

    const expeditionsUpdated = await this.updateExpeditionStates();
    if (expeditionsUpdated > 0) {
      automations.push(`Updated states for ${expeditionsUpdated} expedition(s)`);
    }

    const sessionsClosed = await this.closeExpiredSessions();
    if (sessionsClosed > 0) {
      automations.push(`Closed ${sessionsClosed} expired session(s) with notification`);
    }

    const tokensInvalidated = await this.invalidateExpiredTokens();
    if (tokensInvalidated > 0) {
      automations.push(`Invalidated ${tokensInvalidated} expired token(s)`);
    }

    return automations;
  }

  private calculateMidnightsPassed(beforeTime: Date, afterTime: Date): number {
    const before = new Date(beforeTime);
    const after = new Date(afterTime);

    let count = 0;
    const currentTime = new Date(before);
    currentTime.setUTCHours(0, 0, 0, 0);
    currentTime.setUTCDate(currentTime.getUTCDate() + 1);

    while (currentTime <= after) {
      count++;
      currentTime.setUTCDate(currentTime.getUTCDate() + 1);
    }

    return count;
  }

  private async executeDailyCycles(count: number): Promise<void> {
    const temporalAutomationService = this.moduleRef.get(TemporalAutomationService, {
      strict: false,
    });

    if (!temporalAutomationService) {
      this.logger.warn('TemporalAutomationService not available');
      return;
    }

    for (let i = 0; i < count; i++) {
      try {
        await temporalAutomationService.runDailyResourceCycle();
        this.logger.debug(`Daily cycle ${i + 1}/${count} completed`);
      } catch (error) {
        this.logger.warn(`Error in daily cycle ${i + 1}:`, error);
      }
    }
  }

  private async updateExpeditionStates(): Promise<number> {
    const expeditionService = this.moduleRef.get(ExpeditionService, { strict: false });

    if (!expeditionService) {
      this.logger.warn('ExpeditionService not available');
      return 0;
    }

    try {
      const expeditions = await this.expeditionRepo.find();
      let updated = 0;

      for (const expedition of expeditions) {
        if (['COMPLETED', 'CANCELED', 'RETURNED_AFTER_LOST'].includes(expedition.status)) {
          continue;
        }

        try {
          const result = await expeditionService.forceUpdateExpeditionState(expedition.id);
          if (result && result.status !== expedition.status) {
            updated++;
            this.logger.debug(
              `Expedition ${expedition.id}: ${expedition.status} → ${result.status}`,
            );
          }
        } catch (error) {
          this.logger.warn(`Error updating expedition ${expedition.id}:`, error);
        }
      }

      return updated;
    } catch (error) {
      this.logger.warn('Error updating expedition states:', error);
      return 0;
    }
  }

  private async closeExpiredSessions(): Promise<number> {
    try {
      const allActiveSessions = await this.sessionRepo.find({
        where: { status: 'ACTIVE' },
      });

      const now = this.systemTimeService.now();
      let closed = 0;

      for (const session of allActiveSessions) {
        if (session.expirationDate && session.expirationDate <= now) {
          try {
            await this.sessionRepo.update({ id: session.id }, { status: 'CLOSED' });
            closed++;
            this.logger.debug(`Session ${session.id} closed due to system time advancement`);
          } catch (error) {
            this.logger.warn(`Error closing session ${session.id}:`, error);
          }
        }
      }

      return closed;
    } catch (error) {
      this.logger.warn('Error closing expired sessions:', error);
      return 0;
    }
  }

  private async invalidateExpiredTokens(): Promise<number> {
    try {
      const allActiveTokens = await this.passwordResetTokenRepo.find({
        where: { status: 'ACTIVE' },
      });

      const now = this.systemTimeService.now();
      let invalidated = 0;

      for (const token of allActiveTokens) {
        if (token.expiresAt && token.expiresAt <= now) {
          try {
            await this.passwordResetTokenRepo.update({ id: token.id }, { status: 'EXPIRED' });
            invalidated++;
            this.logger.debug(`Token ${token.id} invalidated`);
          } catch (error) {
            this.logger.warn(`Error invalidating token ${token.id}:`, error);
          }
        }
      }

      return invalidated;
    } catch (error) {
      this.logger.warn('Error invalidating tokens:', error);
      return 0;
    }
  }
}
