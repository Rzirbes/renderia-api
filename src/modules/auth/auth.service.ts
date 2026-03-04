import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../database/prisma/prisma.service';
import * as argon2 from 'argon2';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
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
}
