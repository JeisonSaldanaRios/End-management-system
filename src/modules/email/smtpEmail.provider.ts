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
    const transporter = this.getTransporter();

    const fromAddress = process.env.EMAIL_FROM;
    if (!fromAddress || !fromAddress.trim()) {
      throw new Error('EMAIL_FROM is not configured');
    }

    await transporter.sendMail({
      from: fromAddress.trim(),
      to: email.toEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
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
