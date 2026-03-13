import { Injectable } from '@nestjs/common';
import { LoginUseCase } from './application/use-cases/login.use-case';
import { MeUseCase } from './application/use-cases/me.use-case';
import { RegisterUseCase } from './application/use-cases/register.use-case';
import { ForgotPasswordUseCase } from './application/use-cases/forgot-password.use-case';
import { ResetPasswordUseCase } from './application/use-cases/reset-password.use-case';

@Injectable()
export class AuthService {
  constructor(
    private readonly loginUseCase: LoginUseCase,
    private readonly meUseCase: MeUseCase,
    private readonly registerUseCase: RegisterUseCase,
    private readonly forgotPasswordUseCase: ForgotPasswordUseCase,
    private readonly resetPasswordUseCase: ResetPasswordUseCase,
  ) {}

  async register(input: { name?: string; email: string; password: string }) {
    return this.registerUseCase.execute(input);
  }

  async login(input: { email: string; password: string }) {
    return this.loginUseCase.execute(input);
  }

  async me(userId: string) {
    return this.meUseCase.execute(userId);
  }

  async forgotPassword(input: { email: string; locale?: string }) {
    return this.forgotPasswordUseCase.execute(input);
  }

  async resetPassword(input: { token: string; newPassword: string }) {
    return this.resetPasswordUseCase.execute(input);
  }
}
