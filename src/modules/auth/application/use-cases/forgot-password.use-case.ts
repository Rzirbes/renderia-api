import { Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';

import { MailService } from 'src/modules/mail/mail.service';
import { UserRepository } from 'src/modules/auth/domain/repositories/user.repository';

type ForgotPasswordInput = {
  email: string;
  locale?: string;
};

type ForgotPasswordOutput = {
  ok: true;
  token?: string;
  resetLink?: string;
};

@Injectable()
export class ForgotPasswordUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly mailService: MailService,
  ) {}

  async execute(input: ForgotPasswordInput): Promise<ForgotPasswordOutput> {
    const user = await this.userRepository.findByEmail(input.email);

    if (!user) {
      return { ok: true };
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    user.resetPasswordTokenHash = tokenHash;
    user.resetPasswordExpiresAt = expiresAt;

    await this.userRepository.save(user);

    const frontUrl = process.env.FRONT_URL ?? 'http://localhost:3001';
    const locale = input.locale?.trim() || 'pt-BR';

    const resetLink = `${frontUrl}/${locale}/reset-password?token=${encodeURIComponent(token)}`;

    await this.mailService.sendResetPasswordEmail({
      to: user.email,
      resetLink,
    });

    if (process.env.NODE_ENV !== 'production') {
      return { ok: true, token, resetLink };
    }

    return { ok: true };
  }
}
