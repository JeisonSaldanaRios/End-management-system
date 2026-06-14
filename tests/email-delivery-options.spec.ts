import { expect, test } from '@playwright/test';

import { EmailDeliveryProcessor } from '../src/modules/email/emailDelivery.processor';
import type { EmailOutboxEntity } from '../src/modules/email/emailOutbox.entity';
import { EmailOutboxService } from '../src/modules/email/emailOutbox.service';
import { EmailTemplateService } from '../src/modules/email/emailTemplate.service';
import { SmtpEmailProvider } from '../src/modules/email/smtpEmail.provider';

function makeEntry(overrides: Partial<EmailOutboxEntity> = {}): EmailOutboxEntity {
  return {
    id: overrides.id ?? 1,
    toEmail: overrides.toEmail ?? 'user@example.com',
    subject: overrides.subject ?? 'Subject',
    templateKey: overrides.templateKey ?? 'password_reset_request',
    payload: overrides.payload ?? {
      resetCode: '12345678',
      expirationMinutes: '30',
    },
    status: overrides.status ?? 'PENDING',
    attempts: overrides.attempts ?? 0,
    maxAttempts: overrides.maxAttempts ?? 5,
    nextAttemptAt: overrides.nextAttemptAt ?? new Date(Date.now() - 60_000),
    lastError: overrides.lastError ?? null,
    sentAt: overrides.sentAt ?? null,
    createdAt: overrides.createdAt ?? new Date(),
  };
}

test.describe('Email Delivery Processor options', () => {
  test('skips processing when EMAIL_ENABLED is false', async () => {
    process.env.EMAIL_ENABLED = 'false';

    const outboxCalls = {
      findDueForDelivery: 0,
      save: 0,
    };

    const outboxMock = {
      async findDueForDelivery(): Promise<EmailOutboxEntity[]> {
        outboxCalls.findDueForDelivery += 1;
        return [];
      },
      async save(entity: EmailOutboxEntity): Promise<EmailOutboxEntity> {
        outboxCalls.save += 1;
        return entity;
      },
    };

    const templateMock = {
      render: () => ({ subject: 'x', html: '<p>x</p>', text: 'x' }),
    };

    const smtpMock = {
      isEnabled: () => false,
      async sendMail(): Promise<void> {
        throw new Error('should not send when disabled');
      },
    };

    const processor = new EmailDeliveryProcessor(
      outboxMock as unknown as EmailOutboxService,
      templateMock as unknown as EmailTemplateService,
      smtpMock as unknown as SmtpEmailProvider,
    );

    await processor.processPendingEmails();

    expect(outboxCalls.findDueForDelivery).toBe(0);
    expect(outboxCalls.save).toBe(0);
  });

  test('processes a PENDING email successfully and marks it as SENT', async () => {
    process.env.EMAIL_ENABLED = 'true';
    process.env.EMAIL_PROCESSING_LEASE_MINUTES = '12';

    const entry = makeEntry({ status: 'PENDING' });
    const savedStatuses: string[] = [];
    const savedNextAttemptAt: Date[] = [];

    const outboxMock = {
      async findDueForDelivery(): Promise<EmailOutboxEntity[]> {
        return [entry];
      },
      async save(entity: EmailOutboxEntity): Promise<EmailOutboxEntity> {
        savedStatuses.push(entity.status);
        savedNextAttemptAt.push(new Date(entity.nextAttemptAt));
        return entity;
      },
    };

    const templateMock = {
      render: () => ({ subject: 'Rendered Subject', html: '<p>ok</p>', text: 'ok' }),
    };

    let sentCount = 0;
    const smtpMock = {
      isEnabled: () => true,
      async sendMail(): Promise<void> {
        sentCount += 1;
      },
    };

    const processor = new EmailDeliveryProcessor(
      outboxMock as unknown as EmailOutboxService,
      templateMock as unknown as EmailTemplateService,
      smtpMock as unknown as SmtpEmailProvider,
    );

    const start = Date.now();
    await processor.processPendingEmails();
    const end = Date.now();

    expect(sentCount).toBe(1);
    expect(savedStatuses).toEqual(['PROCESSING', 'SENT']);
    expect(entry.status).toBe('SENT');
    expect(entry.lastError).toBeNull();
    expect(entry.sentAt).not.toBeNull();

    const leaseMs = savedNextAttemptAt[0].getTime() - start;
    const minExpectedMs = 11 * 60 * 1000;
    const maxExpectedMs = 13 * 60 * 1000 + (end - start);
    expect(leaseMs).toBeGreaterThan(minExpectedMs);
    expect(leaseMs).toBeLessThan(maxExpectedMs);
  });

  test('recovers stale PROCESSING email and retries when delivery fails', async () => {
    process.env.EMAIL_ENABLED = 'true';
    process.env.EMAIL_PROCESSING_LEASE_MINUTES = '9';

    const entry = makeEntry({ status: 'PROCESSING', attempts: 1, maxAttempts: 5 });
    const statuses: string[] = [];

    const outboxMock = {
      async findDueForDelivery(): Promise<EmailOutboxEntity[]> {
        return [entry];
      },
      async save(entity: EmailOutboxEntity): Promise<EmailOutboxEntity> {
        statuses.push(entity.status);
        return entity;
      },
    };

    const templateMock = {
      render: () => ({ subject: 'Rendered', html: '<p>fail</p>', text: 'fail' }),
    };

    const smtpMock = {
      isEnabled: () => true,
      async sendMail(): Promise<void> {
        throw new Error('SMTP temporary failure');
      },
    };

    const processor = new EmailDeliveryProcessor(
      outboxMock as unknown as EmailOutboxService,
      templateMock as unknown as EmailTemplateService,
      smtpMock as unknown as SmtpEmailProvider,
    );

    const before = Date.now();
    await processor.processPendingEmails();
    const after = Date.now();

    expect(statuses).toEqual(['PROCESSING', 'PENDING']);
    expect(entry.attempts).toBe(2);
    expect(entry.status).toBe('PENDING');
    expect(entry.lastError).toContain('SMTP temporary failure');

    const retryDelayMs = entry.nextAttemptAt.getTime() - before;
    const minRetryDelayMs = 5 * 60 * 1000;
    const maxRetryDelayMs = 6 * 60 * 1000 + (after - before);
    expect(retryDelayMs).toBeGreaterThanOrEqual(minRetryDelayMs);
    expect(retryDelayMs).toBeLessThan(maxRetryDelayMs);
  });

  test('marks email as FAILED when max attempts is reached', async () => {
    process.env.EMAIL_ENABLED = 'true';

    const entry = makeEntry({ status: 'PENDING', attempts: 4, maxAttempts: 5 });
    const statuses: string[] = [];

    const outboxMock = {
      async findDueForDelivery(): Promise<EmailOutboxEntity[]> {
        return [entry];
      },
      async save(entity: EmailOutboxEntity): Promise<EmailOutboxEntity> {
        statuses.push(entity.status);
        return entity;
      },
    };

    const templateMock = {
      render: () => ({ subject: 'Rendered', html: '<p>boom</p>', text: 'boom' }),
    };

    const smtpMock = {
      isEnabled: () => true,
      async sendMail(): Promise<void> {
        throw new Error('SMTP permanent failure');
      },
    };

    const processor = new EmailDeliveryProcessor(
      outboxMock as unknown as EmailOutboxService,
      templateMock as unknown as EmailTemplateService,
      smtpMock as unknown as SmtpEmailProvider,
    );

    await processor.processPendingEmails();

    expect(statuses).toEqual(['PROCESSING', 'FAILED']);
    expect(entry.attempts).toBe(5);
    expect(entry.status).toBe('FAILED');
    expect(entry.lastError).toContain('SMTP permanent failure');
  });

  test('uses default lease when EMAIL_PROCESSING_LEASE_MINUTES is invalid', async () => {
    process.env.EMAIL_ENABLED = 'true';
    process.env.EMAIL_PROCESSING_LEASE_MINUTES = 'invalid';

    const entry = makeEntry({ status: 'PENDING' });
    const firstSaveLease: Date[] = [];

    const outboxMock = {
      async findDueForDelivery(): Promise<EmailOutboxEntity[]> {
        return [entry];
      },
      async save(entity: EmailOutboxEntity): Promise<EmailOutboxEntity> {
        if (entity.status === 'PROCESSING') {
          firstSaveLease.push(new Date(entity.nextAttemptAt));
        }
        return entity;
      },
    };

    const templateMock = {
      render: () => ({ subject: 'Rendered', html: '<p>ok</p>', text: 'ok' }),
    };

    const smtpMock = {
      isEnabled: () => true,
      async sendMail(): Promise<void> {
        return;
      },
    };

    const processor = new EmailDeliveryProcessor(
      outboxMock as unknown as EmailOutboxService,
      templateMock as unknown as EmailTemplateService,
      smtpMock as unknown as SmtpEmailProvider,
    );

    const before = Date.now();
    await processor.processPendingEmails();
    const after = Date.now();

    const leaseMs = firstSaveLease[0].getTime() - before;
    const minExpectedMs = 9 * 60 * 1000;
    const maxExpectedMs = 11 * 60 * 1000 + (after - before);
    expect(leaseMs).toBeGreaterThan(minExpectedMs);
    expect(leaseMs).toBeLessThan(maxExpectedMs);
  });
});

test.describe('SMTP provider options', () => {
  test('isEnabled reflects EMAIL_ENABLED value', () => {
    const provider = new SmtpEmailProvider();

    process.env.EMAIL_ENABLED = 'true';
    expect(provider.isEnabled()).toBe(true);

    process.env.EMAIL_ENABLED = 'false';
    expect(provider.isEnabled()).toBe(false);
  });

  test('sendMail throws if EMAIL_FROM is missing', async () => {
    const provider = new SmtpEmailProvider() as unknown as {
      transporter: {
        sendMail: () => Promise<void>;
      };
      sendMail: (input: {
        toEmail: string;
        subject: string;
        html: string;
        text: string;
      }) => Promise<void>;
    };

    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_SECURE = 'false';
    delete process.env.EMAIL_FROM;

    provider.transporter = {
      async sendMail(): Promise<void> {
        return;
      },
    };

    await expect(
      provider.sendMail({
        toEmail: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
        text: 'Test',
      }),
    ).rejects.toThrow('EMAIL_FROM is not configured');
  });

  test('sendMail uses configured sender when EMAIL_FROM is present', async () => {
    const provider = new SmtpEmailProvider() as unknown as {
      transporter: {
        sendMail: (payload: {
          from: string;
          to: string;
          subject: string;
          html: string;
          text: string;
        }) => Promise<void>;
      };
      sendMail: (input: {
        toEmail: string;
        subject: string;
        html: string;
        text: string;
      }) => Promise<void>;
    };

    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_SECURE = 'false';
    process.env.EMAIL_FROM = ' no-reply@example.com ';

    const calls: Array<{
      from: string;
      to: string;
      subject: string;
      html: string;
      text: string;
    }> = [];

    provider.transporter = {
      async sendMail(payload): Promise<void> {
        calls.push(payload);
      },
    };

    await provider.sendMail({
      toEmail: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hello</p>',
      text: 'Hello',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].from).toBe('no-reply@example.com');
    expect(calls[0].to).toBe('user@example.com');
  });
});
