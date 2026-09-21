import { Injectable, Logger } from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private sesClient: SESClient | null = null;

  constructor() {
    // SES hanya diaktifkan kalau region eksplisit di-set — supaya development
    // lokal tidak perlu kredensial AWS asli sama sekali. Tanpa ini, developer
    // baru harus setup AWS credentials cuma untuk coba fitur reset password.
    if (process.env.AWS_SES_REGION) {
      this.sesClient = new SESClient({ region: process.env.AWS_SES_REGION });
    }
  }

  async sendPasswordResetEmail(toEmail: string, resetLink: string): Promise<void> {
    if (!this.sesClient) {
      this.logger.warn(
        `AWS_SES_REGION belum di-set — email tidak benar-benar terkirim. Link reset (untuk testing lokal): ${resetLink}`,
      );
      return;
    }

    const fromEmail = process.env.SES_FROM_EMAIL ?? 'no-reply@example.com';

    await this.sesClient.send(
      new SendEmailCommand({
        Source: fromEmail,
        Destination: { ToAddresses: [toEmail] },
        Message: {
          Subject: { Data: 'Reset password akun kamu' },
          Body: {
            Text: {
              Data: `Klik link berikut untuk reset password (berlaku 1 jam):\n\n${resetLink}\n\nKalau kamu tidak meminta ini, abaikan saja email ini.`,
            },
          },
        },
      }),
    );
  }
}
