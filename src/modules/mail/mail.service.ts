import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Resend } from 'resend';

type SendResetPasswordEmailInput = {
  to: string;
  resetLink: string;
};

@Injectable()
export class MailService {
  private resend = new Resend(process.env.RESEND_API_KEY);

  private from() {
    const name = process.env.EMAIL_FROM_NAME ?? 'RenderIA';
    const email = process.env.EMAIL_FROM_EMAIL ?? 'onboarding@resend.dev';
    return `${name} <${email}>`;
  }

  async sendResetPasswordEmail(input: SendResetPasswordEmailInput) {
    const appName = process.env.APP_NAME ?? 'RenderIA';

    const html = `
      <div style="font-family: Arial, sans-serif;">
        <h2>Redefinição de senha - ${appName}</h2>
        <p>Você solicitou redefinir sua senha.</p>
        <p>
          <a href="${input.resetLink}">
            Redefinir senha
          </a>
        </p>
        <p>Este link expira em 30 minutos.</p>
      </div>
    `;
    console.log('[MAIL] sending to:', input.to);
    try {
      const result = await this.resend.emails.send({
        from: this.from(),
        to: input.to,
        subject: `Redefinição de senha - ${appName}`,
        html,
      });

      console.log('[MAIL] resend result:', result);
      return result;
    } catch (err) {
      console.error('[MAIL] resend error:', err);
      throw new InternalServerErrorException(
        `Erro ao enviar email: ${String(err)}`,
      );
    }
  }
}
