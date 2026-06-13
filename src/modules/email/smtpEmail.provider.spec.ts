import { SmtpEmailProvider } from './smtpEmail.provider';
import * as nodemailer from 'nodemailer';

jest.mock('nodemailer');

describe('SmtpEmailProvider', () => {
  let provider: SmtpEmailProvider;
  let mockTransporter: any;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new SmtpEmailProvider();

    mockTransporter = {
      sendMail: jest.fn().mockResolvedValue(undefined),
    };
    (nodemailer.createTransport as jest.Mock).mockReturnValue(mockTransporter);

    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation();

    // Clean env variables
    delete process.env.EMAIL_ENABLED;
    delete process.env.EMAIL_FROM;
    delete process.env.EMAIL_PROVIDER;
    delete process.env.RESEND_API_KEY;
    delete process.env.SENDGRID_API_KEY;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('isEnabled', () => {
    it('should return true if EMAIL_ENABLED env var is "true" case-insensitively', () => {
      process.env.EMAIL_ENABLED = 'TRUE';
      expect(provider.isEnabled()).toBe(true);

      process.env.EMAIL_ENABLED = 'true';
      expect(provider.isEnabled()).toBe(true);
    });

    it('should return false if EMAIL_ENABLED env var is not "true"', () => {
      process.env.EMAIL_ENABLED = 'false';
      expect(provider.isEnabled()).toBe(false);

      delete process.env.EMAIL_ENABLED;
      expect(provider.isEnabled()).toBe(false);
    });
  });

  describe('sendMail', () => {
    it('should throw if EMAIL_FROM is not configured', async () => {
      process.env.SMTP_HOST = 'smtp.gmail.com';
      process.env.EMAIL_FROM = '  ';

      await expect(
        provider.sendMail({
          toEmail: 'test@example.com',
          subject: 'Subject',
          html: '<p>HTML</p>',
          text: 'Text',
        }),
      ).rejects.toThrow('EMAIL_FROM is not configured');
    });

    it('should throw if SMTP_HOST is not configured', async () => {
      process.env.EMAIL_FROM = 'noreply@example.com';
      delete process.env.SMTP_HOST;

      await expect(
        provider.sendMail({
          toEmail: 'test@example.com',
          subject: 'Subject',
          html: '<p>HTML</p>',
          text: 'Text',
        }),
      ).rejects.toThrow('SMTP_HOST is not configured');
    });

    it('should throw if SMTP_PORT is not a positive integer', async () => {
      process.env.EMAIL_FROM = 'noreply@example.com';
      process.env.SMTP_HOST = 'smtp.gmail.com';
      process.env.SMTP_PORT = 'invalid';

      await expect(
        provider.sendMail({
          toEmail: 'test@example.com',
          subject: 'Subject',
          html: '<p>HTML</p>',
          text: 'Text',
        }),
      ).rejects.toThrow('SMTP_PORT must be a positive integer');
    });

    it('should initialize transporter and send email correctly with auth', async () => {
      process.env.EMAIL_FROM = 'noreply@example.com';
      process.env.SMTP_HOST = 'smtp.gmail.com';
      process.env.SMTP_PORT = '465';
      process.env.SMTP_SECURE = 'true';
      process.env.SMTP_USER = 'user';
      process.env.SMTP_PASS = 'pass';

      await provider.sendMail({
        toEmail: 'dest@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
        text: 'Hi',
      });

      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: 'user',
          pass: 'pass',
        },
      });
      expect(mockTransporter.sendMail).toHaveBeenCalledWith({
        from: 'noreply@example.com',
        to: 'dest@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
        text: 'Hi',
      });
    });

    it('should initialize transporter and send email correctly without auth', async () => {
      process.env.EMAIL_FROM = 'noreply@example.com';
      process.env.SMTP_HOST = 'smtp.gmail.com';
      process.env.SMTP_PORT = '587';
      process.env.SMTP_SECURE = 'false';

      await provider.sendMail({
        toEmail: 'dest@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
        text: 'Hi',
      });

      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: undefined,
      });
      expect(mockTransporter.sendMail).toHaveBeenCalledWith({
        from: 'noreply@example.com',
        to: 'dest@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
        text: 'Hi',
      });
    });

    it('should reuse the initialized transporter on subsequent calls', async () => {
      process.env.EMAIL_FROM = 'noreply@example.com';
      process.env.SMTP_HOST = 'smtp.gmail.com';

      const email = {
        toEmail: 'dest@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
        text: 'Hi',
      };

      await provider.sendMail(email);
      await provider.sendMail(email);

      expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
      expect(mockTransporter.sendMail).toHaveBeenCalledTimes(2);
    });

    it('should throw if EMAIL_PROVIDER is resend but RESEND_API_KEY is not configured', async () => {
      process.env.EMAIL_FROM = 'noreply@example.com';
      process.env.EMAIL_PROVIDER = 'resend';
      delete process.env.RESEND_API_KEY;

      await expect(
        provider.sendMail({
          toEmail: 'test@example.com',
          subject: 'Subject',
          html: '<p>HTML</p>',
          text: 'Text',
        }),
      ).rejects.toThrow('RESEND_API_KEY is not configured');
    });

    it('should send email successfully via Resend API', async () => {
      process.env.EMAIL_FROM = 'noreply@example.com';
      process.env.EMAIL_PROVIDER = 'resend';
      process.env.RESEND_API_KEY = 're_123';

      fetchSpy.mockResolvedValue({
        ok: true,
        text: async () => 'OK',
      } as any);

      await provider.sendMail({
        toEmail: 'test@example.com',
        subject: 'Subject',
        html: '<p>HTML</p>',
        text: 'Text',
      });

      expect(fetchSpy).toHaveBeenCalledWith('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer re_123',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'noreply@example.com',
          to: 'test@example.com',
          subject: 'Subject',
          html: '<p>HTML</p>',
          text: 'Text',
        }),
      });
    });

    it('should throw if Resend API returns error', async () => {
      process.env.EMAIL_FROM = 'noreply@example.com';
      process.env.EMAIL_PROVIDER = 'resend';
      process.env.RESEND_API_KEY = 're_123';

      fetchSpy.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      } as any);

      await expect(
        provider.sendMail({
          toEmail: 'test@example.com',
          subject: 'Subject',
          html: '<p>HTML</p>',
          text: 'Text',
        }),
      ).rejects.toThrow('Resend API failed: 400 - Bad Request');
    });

    it('should throw if EMAIL_PROVIDER is sendgrid but SENDGRID_API_KEY is not configured', async () => {
      process.env.EMAIL_FROM = 'noreply@example.com';
      process.env.EMAIL_PROVIDER = 'sendgrid';
      delete process.env.SENDGRID_API_KEY;

      await expect(
        provider.sendMail({
          toEmail: 'test@example.com',
          subject: 'Subject',
          html: '<p>HTML</p>',
          text: 'Text',
        }),
      ).rejects.toThrow('SENDGRID_API_KEY is not configured');
    });

    it('should send email successfully via SendGrid API', async () => {
      process.env.EMAIL_FROM = 'noreply@example.com';
      process.env.EMAIL_PROVIDER = 'sendgrid';
      process.env.SENDGRID_API_KEY = 'SG.123';

      fetchSpy.mockResolvedValue({
        ok: true,
        text: async () => 'OK',
      } as any);

      await provider.sendMail({
        toEmail: 'test@example.com',
        subject: 'Subject',
        html: '<p>HTML</p>',
        text: 'Text',
      });

      expect(fetchSpy).toHaveBeenCalledWith('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer SG.123',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: 'test@example.com' }] }],
          from: { email: 'noreply@example.com' },
          subject: 'Subject',
          content: [
            { type: 'text/plain', value: 'Text' },
            { type: 'text/html', value: '<p>HTML</p>' },
          ],
        }),
      });
    });

    it('should throw if SendGrid API returns error', async () => {
      process.env.EMAIL_FROM = 'noreply@example.com';
      process.env.EMAIL_PROVIDER = 'sendgrid';
      process.env.SENDGRID_API_KEY = 'SG.123';

      fetchSpy.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      } as any);

      await expect(
        provider.sendMail({
          toEmail: 'test@example.com',
          subject: 'Subject',
          html: '<p>HTML</p>',
          text: 'Text',
        }),
      ).rejects.toThrow('SendGrid API failed: 401 - Unauthorized');
    });

    it('should throw for unsupported provider type', async () => {
      process.env.EMAIL_FROM = 'noreply@example.com';
      process.env.EMAIL_PROVIDER = 'unsupported_provider';

      await expect(
        provider.sendMail({
          toEmail: 'test@example.com',
          subject: 'Subject',
          html: '<p>HTML</p>',
          text: 'Text',
        }),
      ).rejects.toThrow('Unsupported email provider: unsupported_provider');
    });
  });
});
