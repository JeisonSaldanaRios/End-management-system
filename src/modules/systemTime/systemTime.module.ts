import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemTimeController } from './systemTime.controller';
import { SystemTimeService } from './systemTime.service';
import { ExpeditionEntity } from '../expedition/expedition.entity';
import { SessionEntity } from '../session/session.entity';
import { PasswordResetTokenEntity } from '../../auth/passwordResetToken.entity';
import { SystemTimeEntity } from './systemTime.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ExpeditionEntity,
      SessionEntity,
      PasswordResetTokenEntity,
      SystemTimeEntity,
    ]),
  ],
  controllers: [SystemTimeController],
  providers: [SystemTimeService],
  exports: [SystemTimeService],
})
export class SystemTimeModule {}
