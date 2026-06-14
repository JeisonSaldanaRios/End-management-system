import { Module } from '@nestjs/common';

import { OccupationCoverageController } from './occupationCoverage.controller';
import { OccupationCoverageRepository } from './occupationCoverage.repository';
import { OccupationCoverageService } from './occupationCoverage.service';
import { OccupationCoverageScheduler } from './occupationCoverage.scheduler';
import { AuthModule } from '../../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [AuthModule, NotificationModule],
  controllers: [OccupationCoverageController],
  providers: [OccupationCoverageService, OccupationCoverageRepository, OccupationCoverageScheduler],
  exports: [OccupationCoverageService],
})
export class OccupationCoverageModule {}
