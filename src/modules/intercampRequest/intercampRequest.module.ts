import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CampEntity } from '../camp/camp.entity';
import { NotificationModule } from '../notification/notification.module';
import { TransferModule } from '../transfer/transfer.module';
import { TransferPersonModule } from '../transferPerson/transferPerson.module';
import { SystemTimeModule } from '../systemTime/systemTime.module';
import { UserEntity } from '../systemUser/systemUser.entity';
import { IntercampRequestController } from './intercampRequest.controller';
import { IntercampRequestEntity } from './intercampRequest.entity';
import { IntercampRequestRepository } from './intercampRequest.repository';
import { IntercampRequestService } from './intercampRequest.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([IntercampRequestEntity, CampEntity, UserEntity]),
    NotificationModule,
    TransferModule,
    TransferPersonModule,
    SystemTimeModule,
  ],
  controllers: [IntercampRequestController],
  providers: [IntercampRequestRepository, IntercampRequestService],
})
export class IntercampRequestModule {}
