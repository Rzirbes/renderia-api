import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';

import { AuthController } from './controllers/auth.controller';
import { JwtStrategy } from './infrastructure/strategies/jwt.strategy';

import { MailModule } from '../mail/mail.module';
import { PrismaModule } from 'src/database/prisma/prisma.module';

import { UserRepository } from './domain/repositories/user.repository';
import { PrismaUserRepository } from './infrastructure/persistence/prisma/repositories/prisma-user.repository';
import { LoginUseCase } from './application/use-cases/login.use-case';
import { MeUseCase } from './application/use-cases/me.use-case';
import { RegisterUseCase } from './application/use-cases/register.use-case';
import { ForgotPasswordUseCase } from './application/use-cases/forgot-password.use-case';
import { ResetPasswordUseCase } from './application/use-cases/reset-password.use-case';
import { HashService } from './domain/services/hash.service';
import { ArgonHashService } from './infrastructure/adapters/argon-hash.service';
import { TokenService } from './domain/services/token.service';
import { JwtTokenService } from './infrastructure/adapters/jwt-token.service';

@Module({
  imports: [PassportModule, JwtModule.register({}), MailModule, PrismaModule],
  controllers: [AuthController],
  providers: [
    JwtStrategy,
    LoginUseCase,
    MeUseCase,
    RegisterUseCase,
    ForgotPasswordUseCase,
    ResetPasswordUseCase,
    {
      provide: UserRepository,
      useClass: PrismaUserRepository,
    },
    {
      provide: HashService,
      useClass: ArgonHashService,
    },
    {
      provide: TokenService,
      useClass: JwtTokenService,
    },
  ],
  exports: [UserRepository],
})
export class AuthModule {}
