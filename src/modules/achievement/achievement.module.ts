import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AchievementController } from './achievement.controller';
import { AchievementEntity } from './achievement.entity';
import { AchievementRepository } from './achievement.repository';
import { AchievementService } from './achievement.service';
import { AchievementEvaluatorService } from './achievementEvaluator.service';
import { CampModule } from '../camp/camp.module';
import { CampAchievementModule } from '../campAchievement/campAchievement.module';
import { PersonEntity } from '../person/person.entity';
import { ExpeditionEntity } from '../expedition/expedition.entity';
import { IntercampRequestEntity } from '../intercampRequest/intercampRequest.entity';
import { InventoryAlertEntity } from '../inventoryAlert/inventoryAlert.entity';
import { InventoryMovementEntity } from '../inventoryMovement/inventoryMovement.entity';
import { NotificationEntity } from '../notification/notification.entity';
import { SystemTimeModule } from '../systemTime/systemTime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AchievementEntity,
      PersonEntity,
      ExpeditionEntity,
      IntercampRequestEntity,
      InventoryAlertEntity,
      InventoryMovementEntity,
      NotificationEntity,
    ]),
    CampModule,
    CampAchievementModule,
    SystemTimeModule,
  ],
  controllers: [AchievementController],
  providers: [AchievementRepository, AchievementService, AchievementEvaluatorService],
  exports: [AchievementService, AchievementEvaluatorService],
})
export class AchievementModule {}
