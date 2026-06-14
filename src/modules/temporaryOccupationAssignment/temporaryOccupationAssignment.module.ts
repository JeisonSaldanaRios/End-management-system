import { Module, OnModuleInit, Inject } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationModule } from '../notification/notification.module';
import { OccupationCoverageModule } from '../occupationCoverage/occupationCoverage.module';
import { SystemTimeModule } from '../systemTime/systemTime.module';

import { TemporaryOccupationAssignmentController } from './temporaryOccupationAssignment.controller';
import { TemporaryOccupationAssignmentEntity } from './temporaryOccupationAssignment.entity';
import { TemporaryOccupationAssignmentRepository } from './temporaryOccupationAssignment.repository';
import { TemporaryOccupationAssignmentService } from './temporaryOccupationAssignment.service';
import { OccupationCoverageService } from '../occupationCoverage/occupationCoverage.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TemporaryOccupationAssignmentEntity]),
    NotificationModule,
    OccupationCoverageModule,
    SystemTimeModule,
  ],
  controllers: [TemporaryOccupationAssignmentController],
  providers: [TemporaryOccupationAssignmentRepository, TemporaryOccupationAssignmentService],
})
export class TemporaryOccupationAssignmentModule implements OnModuleInit {
  constructor(
    private readonly temporaryAssignmentService: TemporaryOccupationAssignmentService,
    @Inject(OccupationCoverageService)
    private readonly occupationCoverageService: OccupationCoverageService,
  ) {}

  onModuleInit(): void {
    this.occupationCoverageService.setTemporaryAssignmentService(this.temporaryAssignmentService);
  }
}
