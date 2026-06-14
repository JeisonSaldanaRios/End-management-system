import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

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
import { NotificationModule } from '../notification/notification.module';
import { OccupationEntity } from '../occupation/occupation.entity';
import { PersonEntity } from '../person/person.entity';
import { ResourceTypeEntity } from '../resourceType/resourceType.entity';
import { UserEntity } from '../systemUser/systemUser.entity';
import { SystemTimeModule } from '../systemTime/systemTime.module';
import { TemporaryOccupationAssignmentEntity } from '../temporaryOccupationAssignment/temporaryOccupationAssignment.entity';
import { TransferModule } from '../transfer/transfer.module';
import { TransferEntity } from '../transfer/transfer.entity';
import { TemporalAutomationRepository } from './temporalAutomation.repository';
import { TemporalAutomationService } from './temporalAutomation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CampEntity,
      CampInventoryEntity,
      DailyCollectionRecordEntity,
      DailyConsumptionEntity,
      ExpeditionEntity,
      ExpeditionParticipantEntity,
      InventoryAlertEntity,
      InventoryMovementEntity,
      OccupationEntity,
      PersonEntity,
      ResourceTypeEntity,
      TemporaryOccupationAssignmentEntity,
      TransferEntity,
      UserEntity,
    ]),
    SystemTimeModule,
    NotificationModule,
    TransferModule,
  ],
  providers: [
    TemporalAutomationService,
    TemporalAutomationRepository,
    ExpeditionParticipantRepository,
    ExpeditionRepository,
  ],
  exports: [TemporalAutomationService],
})
export class TemporalAutomationModule {}
