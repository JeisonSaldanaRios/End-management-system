import { EmailDeliveryProcessor } from './emailDelivery.processor';
import { EmailOutboxService } from './emailOutbox.service';
import { EmailTemplateService } from './emailTemplate.service';
import { SmtpEmailProvider } from './smtpEmail.provider';
import { SystemTimeService } from '../systemTime/systemTime.service';

describe('EmailDeliveryProcessor', () => {
  let processor: EmailDeliveryProcessor;
  let outboxService: jest.Mocked<EmailOutboxService>;
  let templateService: jest.Mocked<EmailTemplateService>;
  let smtpEmailProvider: jest.Mocked<SmtpEmailProvider>;
  let systemTimeService: jest.Mocked<SystemTimeService>;

  beforeEach(() => {
    outboxService = {
      findDueForDelivery: jest.fn(),
      save: jest.fn(),
    } as any;

    templateService = {
      render: jest.fn(),
    } as any;

    smtpEmailProvider = {
      isEnabled: jest.fn(),
      sendMail: jest.fn(),
    } as any;

    systemTimeService = {
      now: jest.fn().mockReturnValue(new Date()),
    } as any;

    processor = new EmailDeliveryProcessor(
      outboxService,
      templateService,
      smtpEmailProvider,
      systemTimeService,
    );

    // Reset env vars
    delete process.env.EMAIL_BATCH_SIZE;
    delete process.env.EMAIL_PROCESSING_LEASE_MINUTES;
  });

  describe('processPendingEmails', () => {
    it('should do nothing if email delivery is disabled', async () => {
      smtpEmailProvider.isEnabled.mockReturnValue(false);

      await processor.processPendingEmails();

      expect(outboxService.findDueForDelivery).not.toHaveBeenCalled();
    });

    it('should process due emails and send them successfully', async () => {
      smtpEmailProvider.isEnabled.mockReturnValue(true);
      const mockEmail = {
        id: 1,
        toEmail: 'test@example.com',
        subject: 'Test Subject',
        templateKey: 'test-template',
        payload: { name: 'Test' },
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
        nextAttemptAt: new Date(),
        lastError: null as string | null,
      };
      outboxService.findDueForDelivery.mockResolvedValue([mockEmail as any]);
      templateService.render.mockReturnValue({
        subject: 'Rendered Subject',
        html: '<p>HTML</p>',
        text: 'Text',
      });
      smtpEmailProvider.sendMail.mockResolvedValue(undefined);

      await processor.processPendingEmails();

      expect(outboxService.findDueForDelivery).toHaveBeenCalled();
      expect(templateService.render).toHaveBeenCalledWith('test-template', { name: 'Test' });
      expect(smtpEmailProvider.sendMail).toHaveBeenCalledWith({
        toEmail: 'test@example.com',
        subject: 'Test Subject',
        html: '<p>HTML</p>',
        text: 'Text',
      });
      expect(mockEmail.status).toBe('SENT');
      expect(mockEmail.lastError).toBeNull();
      expect(outboxService.save).toHaveBeenCalledTimes(2); // One for PROCESSING, one for SENT
    });

    it('should handle sendMail failures, increment attempts, and keep pending if below max attempts', async () => {
      smtpEmailProvider.isEnabled.mockReturnValue(true);
      const mockEmail = {
        id: 2,
        toEmail: 'fail@example.com',
        subject: '',
        templateKey: 'fail-template',
        payload: {},
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
        nextAttemptAt: new Date(),
        lastError: null as string | null,
      };
      outboxService.findDueForDelivery.mockResolvedValue([mockEmail as any]);
      templateService.render.mockReturnValue({
        subject: 'Rendered Subject',
        html: '<p>HTML</p>',
        text: 'Text',
      });
      const errorMsg = 'SMTP Connection Timeout';
      smtpEmailProvider.sendMail.mockRejectedValue(new Error(errorMsg));

      await processor.processPendingEmails();

      expect(mockEmail.status).toBe('PENDING');
      expect(mockEmail.attempts).toBe(1);
      expect(mockEmail.lastError).toBe(errorMsg);
      expect(mockEmail.nextAttemptAt).toBeInstanceOf(Date);
      expect(outboxService.save).toHaveBeenCalledTimes(2);
    });

    it('should handle sendMail failures, and mark as FAILED if max attempts is reached', async () => {
      smtpEmailProvider.isEnabled.mockReturnValue(true);
      const mockEmail = {
        id: 3,
        toEmail: 'fail@example.com',
        subject: '',
        templateKey: 'fail-template',
        payload: {},
        status: 'PENDING',
        attempts: 2,
        maxAttempts: 3,
        nextAttemptAt: new Date(),
        lastError: null as string | null,
      };
      outboxService.findDueForDelivery.mockResolvedValue([mockEmail as any]);
      templateService.render.mockReturnValue({
        subject: 'Rendered Subject',
        html: '<p>HTML</p>',
        text: 'Text',
      });
      smtpEmailProvider.sendMail.mockRejectedValue(new Error('SMTP Error'));

      await processor.processPendingEmails();

      expect(mockEmail.status).toBe('FAILED');
      expect(mockEmail.attempts).toBe(3);
      expect(mockEmail.lastError).toBe('SMTP Error');
      expect(outboxService.save).toHaveBeenCalledTimes(2);
    });

    it('should truncate error messages if they are too long', async () => {
      smtpEmailProvider.isEnabled.mockReturnValue(true);
      const mockEmail = {
        id: 4,
        toEmail: 'fail@example.com',
        subject: '',
        templateKey: 'fail-template',
        payload: {},
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
        nextAttemptAt: new Date(),
        lastError: null as string | null,
      };
      outboxService.findDueForDelivery.mockResolvedValue([mockEmail as any]);
      templateService.render.mockReturnValue({
        subject: 'Rendered Subject',
        html: '<p>HTML</p>',
        text: 'Text',
      });
      const longError = 'a'.repeat(1050);
      smtpEmailProvider.sendMail.mockRejectedValue(new Error(longError));

      await processor.processPendingEmails();

      expect(mockEmail.lastError?.length).toBe(1000);
      expect(mockEmail.lastError?.endsWith('...')).toBe(true);
    });

    it('should handle non-Error exceptions and default to unknown delivery error', async () => {
      smtpEmailProvider.isEnabled.mockReturnValue(true);
      const mockEmail = {
        id: 7,
        toEmail: 'fail@example.com',
        subject: '',
        templateKey: 'fail-template',
        payload: {},
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
        nextAttemptAt: new Date(),
        lastError: null as string | null,
      };
      outboxService.findDueForDelivery.mockResolvedValue([mockEmail as any]);
      templateService.render.mockReturnValue({
        subject: 'Rendered Subject',
        html: '<p>HTML</p>',
        text: 'Text',
      });
      smtpEmailProvider.sendMail.mockRejectedValue('string error'); // not an Error object

      await processor.processPendingEmails();

      expect(mockEmail.lastError).toBe('Unknown email delivery error');
    });

    it('should respect batch size configuration from environment variables', async () => {
      smtpEmailProvider.isEnabled.mockReturnValue(true);
      process.env.EMAIL_BATCH_SIZE = '5';
      outboxService.findDueForDelivery.mockResolvedValue([]);

      await processor.processPendingEmails();

      expect(outboxService.findDueForDelivery).toHaveBeenCalledWith(5, expect.any(Date));
    });

    it('should fallback to default batch size (20) if EMAIL_BATCH_SIZE is invalid', async () => {
      smtpEmailProvider.isEnabled.mockReturnValue(true);
      process.env.EMAIL_BATCH_SIZE = 'invalid';
      outboxService.findDueForDelivery.mockResolvedValue([]);

      await processor.processPendingEmails();

      expect(outboxService.findDueForDelivery).toHaveBeenCalledWith(20, expect.any(Date));
    });

    it('should respect email processing lease minutes from environment variables', async () => {
      smtpEmailProvider.isEnabled.mockReturnValue(true);
      process.env.EMAIL_PROCESSING_LEASE_MINUTES = '15';
      const mockEmail = {
        id: 5,
        toEmail: 'test@example.com',
        subject: 'Test Subject',
        templateKey: 'test-template',
        payload: {},
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
        nextAttemptAt: new Date(),
      };
      outboxService.findDueForDelivery.mockResolvedValue([mockEmail as any]);
      templateService.render.mockReturnValue({
        subject: 'Rendered Subject',
        html: '<p>HTML</p>',
        text: 'Text',
      });
      smtpEmailProvider.sendMail.mockResolvedValue(undefined);

      const before = new Date();
      await processor.processPendingEmails();
      const after = new Date();

      const leaseDiffMs = mockEmail.nextAttemptAt.getTime() - before.getTime();
      const leaseMinutes = leaseDiffMs / (1000 * 60);
      expect(leaseMinutes).toBeCloseTo(15, 1);
    });

    it('should fallback to 10 minutes lease if EMAIL_PROCESSING_LEASE_MINUTES is invalid', async () => {
      smtpEmailProvider.isEnabled.mockReturnValue(true);
      process.env.EMAIL_PROCESSING_LEASE_MINUTES = 'invalid';
      const mockEmail = {
        id: 6,
        toEmail: 'test@example.com',
        subject: 'Test Subject',
        templateKey: 'test-template',
        payload: {},
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
        nextAttemptAt: new Date(),
      };
      outboxService.findDueForDelivery.mockResolvedValue([mockEmail as any]);
      templateService.render.mockReturnValue({
        subject: 'Rendered Subject',
        html: '<p>HTML</p>',
        text: 'Text',
      });
      smtpEmailProvider.sendMail.mockResolvedValue(undefined);

      const before = new Date();
      await processor.processPendingEmails();

      const leaseDiffMs = mockEmail.nextAttemptAt.getTime() - before.getTime();
      const leaseMinutes = leaseDiffMs / (1000 * 60);
      expect(leaseMinutes).toBeCloseTo(10, 1);
    });
  });
});
