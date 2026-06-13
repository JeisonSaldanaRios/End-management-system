import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

interface OutboundEmail {
  toEmail: string;
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class SmtpEmailProvider {
  private transporter: nodemailer.Transporter | null = null;

  isEnabled(): boolean {
    return (process.env.EMAIL_ENABLED ?? 'false').toLowerCase() === 'true';
  }

  async sendMail(email: OutboundEmail): Promise<void> {
    const fromAddress = process.env.EMAIL_FROM;
    if (!fromAddress || !fromAddress.trim()) {
      throw new Error('EMAIL_FROM is not configured');
    }

    const providerType = (process.env.EMAIL_PROVIDER ?? 'smtp').toLowerCase();

    if (providerType === 'smtp') {
      await this.sendMailSmtp(email, fromAddress);
    } else if (providerType === 'resend') {
      await this.sendMailResend(email, fromAddress);
    } else if (providerType === 'sendgrid') {
      await this.sendMailSendGrid(email, fromAddress);
    } else {
      throw new Error(`Unsupported email provider: ${providerType}`);
    }
  }

  private async sendMailSmtp(email: OutboundEmail, fromAddress: string): Promise<void> {
    const transporter = this.getTransporter();
    await transporter.sendMail({
      from: fromAddress.trim(),
      to: email.toEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  }

  private async sendMailResend(email: OutboundEmail, fromAddress: string): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress.trim(),
        to: email.toEmail,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Resend API failed: ${response.status} - ${errorText}`);
    }
  }

  private async sendMailSendGrid(email: OutboundEmail, fromAddress: string): Promise<void> {
    const apiKey = process.env.SENDGRID_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('SENDGRID_API_KEY is not configured');
    }

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: email.toEmail }] }],
        from: { email: fromAddress.trim() },
        subject: email.subject,
        content: [
          { type: 'text/plain', value: email.text },
          { type: 'text/html', value: email.html },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SendGrid API failed: ${response.status} - ${errorText}`);
    }
  }

  private getTransporter(): nodemailer.Transporter {
    if (this.transporter) {
      return this.transporter;
    }

    const host = process.env.SMTP_HOST?.trim();
    const port = Number.parseInt(process.env.SMTP_PORT ?? '587', 10);
    const secure = (process.env.SMTP_SECURE ?? 'false').toLowerCase() === 'true';
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS?.trim();

    if (!host) {
      throw new Error('SMTP_HOST is not configured');
    }

    if (!Number.isInteger(port) || port <= 0) {
      throw new Error('SMTP_PORT must be a positive integer');
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth:
        user && pass
          ? {
              user,
              pass,
            }
          : undefined,
    });

    return this.transporter;
  }
}
