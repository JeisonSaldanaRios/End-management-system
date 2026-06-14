import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { EmailOutboxService } from './emailOutbox.service';
import { EmailTemplateService } from './emailTemplate.service';
import { SmtpEmailProvider } from './smtpEmail.provider';
import { SystemTimeService } from '../systemTime/systemTime.service';

const EMAIL_PROCESSOR_CRON = process.env.EMAIL_PROCESSOR_CRON ?? CronExpression.EVERY_MINUTE;
const RETRY_DELAYS_MINUTES = [1, 5, 15, 60, 360] as const;

@Injectable()
export class EmailDeliveryProcessor {
  private readonly logger = new Logger(EmailDeliveryProcessor.name);

  constructor(
    private readonly outboxService: EmailOutboxService,
    private readonly templateService: EmailTemplateService,
    private readonly smtpEmailProvider: SmtpEmailProvider,
    private readonly systemTimeService: SystemTimeService,
  ) {}

  @Cron(EMAIL_PROCESSOR_CRON)
  async processPendingEmails(): Promise<void> {
    if (!this.smtpEmailProvider.isEnabled()) {
      return;
    }

    const limit = this.resolveBatchSize();
    const now = this.systemTimeService.now();
    const dueEmails = await this.outboxService.findDueForDelivery(limit, now);

    for (const entry of dueEmails) {
      entry.status = 'PROCESSING';
      entry.nextAttemptAt = this.calculateProcessingLeaseDate();
      await this.outboxService.save(entry);

      try {
        const rendered = this.templateService.render(entry.templateKey, entry.payload);
        await this.smtpEmailProvider.sendMail({
          toEmail: entry.toEmail,
          subject: entry.subject || rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });

        entry.status = 'SENT';
        entry.sentAt = this.systemTimeService.now();
        entry.lastError = null;
        await this.outboxService.save(entry);
      } catch (error) {
        const failedAttempts = entry.attempts + 1;
        entry.attempts = failedAttempts;
        entry.lastError = this.truncateError(error);

        if (failedAttempts >= entry.maxAttempts) {
          entry.status = 'FAILED';
        } else {
          entry.status = 'PENDING';
          entry.nextAttemptAt = this.calculateNextAttemptDate(failedAttempts);
        }

        await this.outboxService.save(entry);
        this.logger.warn(
          `Email delivery failed for outbox id=${entry.id}, attempts=${failedAttempts}, status=${entry.status}`,
        );
      }
    }
  }

  private resolveBatchSize(): number {
    const parsed = Number.parseInt(process.env.EMAIL_BATCH_SIZE ?? '20', 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return 20;
    }

    return parsed;
  }

  private calculateNextAttemptDate(failedAttempts: number): Date {
    const index = Math.max(0, Math.min(failedAttempts - 1, RETRY_DELAYS_MINUTES.length - 1));
    const delayMinutes = RETRY_DELAYS_MINUTES[index]!;
    const next = this.systemTimeService.now();
    next.setMinutes(next.getMinutes() + delayMinutes);
    return next;
  }

  private calculateProcessingLeaseDate(): Date {
    const parsed = Number.parseInt(process.env.EMAIL_PROCESSING_LEASE_MINUTES ?? '10', 10);
    const leaseMinutes = Number.isInteger(parsed) && parsed > 0 ? parsed : 10;
    const next = this.systemTimeService.now();
    next.setMinutes(next.getMinutes() + leaseMinutes);
    return next;
  }

  private truncateError(error: unknown): string {
    const message = error instanceof Error ? error.message : 'Unknown email delivery error';
    if (message.length <= 1000) {
      return message;
    }

    return `${message.slice(0, 997)}...`;
  }
}
