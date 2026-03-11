import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../database/prisma/prisma.service';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'crypto';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  async register(input: { name?: string; email: string; password: string }) {
    const exists = await this.prisma.user.findUnique({
      where: { email: input.email },
    });
    if (exists) throw new ConflictException('E-mail já cadastrado');

    const hash = await argon2.hash(input.password);

    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        password: hash,
        credits: 0,
      },
      select: {
        id: true,
        name: true,
        email: true,
        credits: true,
        createdAt: true,
      },
    });

    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email },
      { secret: process.env.JWT_SECRET, expiresIn: '7d' },
    );

    return { user, accessToken };
  }

  async login(input: { email: string; password: string }) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
    });
    if (!user) throw new UnauthorizedException('Credenciais inválidas');

    const ok = await argon2.verify(user.password, input.password);
    if (!ok) throw new UnauthorizedException('Credenciais inválidas');

    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email },
      { secret: process.env.JWT_SECRET, expiresIn: '7d' },
    );

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        credits: user.credits,
        createdAt: user.createdAt,
      },
      accessToken,
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        credits: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    return { user };
  }

  async forgotPassword(input: { email: string; locale?: string }) {
    console.log('[FORGOT] start');
    console.log('[FORGOT] email:', input.email);
    console.log('[FORGOT] FRONT_URL:', process.env.FRONT_URL);
    console.log(
      '[FORGOT] RESEND_API_KEY exists:',
      !!process.env.RESEND_API_KEY,
    );
    console.log('[FORGOT] EMAIL_FROM_EMAIL:', process.env.EMAIL_FROM_EMAIL);
    console.log('[FORGOT] EMAIL_FROM_NAME:', process.env.EMAIL_FROM_NAME);

    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, email: true },
    });

    console.log('[FORGOT] user found:', !!user);
    console.log('[FORGOT] user id:', user?.id ?? null);

    if (!user) {
      console.log('[FORGOT] user not found, returning ok');
      return { ok: true };
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordTokenHash: tokenHash,
        resetPasswordExpiresAt: expiresAt,
      },
    });

    const frontUrl = process.env.FRONT_URL ?? 'http://localhost:3001';
    const locale = input.locale?.trim() || 'pt-BR';

    const resetLink = `${frontUrl}/${locale}/reset-password?token=${encodeURIComponent(token)}`;

    await this.mail.sendResetPasswordEmail({
      to: user.email,
      resetLink,
    });

    if (process.env.NODE_ENV !== 'production') {
      return { ok: true, token, resetLink };
    }

    return { ok: true };
  }

  async resetPassword(input: { token: string; newPassword: string }) {
    const tokenHash = createHash('sha256').update(input.token).digest('hex');

    const user = await this.prisma.user.findFirst({
      where: {
        resetPasswordTokenHash: tokenHash,
        resetPasswordExpiresAt: { gt: new Date() },
      },
      select: { id: true },
    });

    if (!user) throw new BadRequestException('Token inválido ou expirado');

    const newHash = await argon2.hash(input.newPassword);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: newHash,
        resetPasswordTokenHash: null,
        resetPasswordExpiresAt: null,
      },
    });

    return { ok: true };
  }
}
