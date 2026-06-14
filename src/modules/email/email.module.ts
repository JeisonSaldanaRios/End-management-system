import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EmailDeliveryProcessor } from './emailDelivery.processor';
import { EmailOutboxEntity } from './emailOutbox.entity';
import { EmailOutboxRepository } from './emailOutbox.repository';
import { EmailOutboxService } from './emailOutbox.service';
import { EmailTemplateService } from './emailTemplate.service';
import { SmtpEmailProvider } from './smtpEmail.provider';
import { SystemTimeModule } from '../systemTime/systemTime.module';

@Module({
  imports: [TypeOrmModule.forFeature([EmailOutboxEntity]), SystemTimeModule],
  providers: [
    EmailOutboxRepository,
    EmailOutboxService,
    EmailTemplateService,
    SmtpEmailProvider,
    EmailDeliveryProcessor,
  ],
  exports: [EmailOutboxService, EmailTemplateService],
})
export class EmailModule {}
