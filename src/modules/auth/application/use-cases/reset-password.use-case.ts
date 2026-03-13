import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

import { UserRepository } from '../../domain/repositories/user.repository';
import { HashService } from '../../domain/services/hash.service';

type ResetPasswordInput = {
  token: string;
  newPassword: string;
};

@Injectable()
export class ResetPasswordUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly hashService: HashService,
  ) {}

  async execute(input: ResetPasswordInput) {
    const tokenHash = createHash('sha256').update(input.token).digest('hex');

    const user =
      await this.userRepository.findByResetPasswordTokenHash(tokenHash);

    if (!user) {
      throw new BadRequestException('Token inválido ou expirado');
    }

    const newPasswordHash = await this.hashService.hash(input.newPassword);

    user.passwordHash = newPasswordHash;
    user.resetPasswordTokenHash = null;
    user.resetPasswordExpiresAt = null;

    await this.userRepository.save(user);

    return { ok: true };
  }
}
