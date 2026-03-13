import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma/prisma.service';

import { User } from 'src/modules/auth/domain/entities/auth-user.entity';
import { UserRepository } from 'src/modules/auth/domain/repositories/user.repository';
import { PrismaUserMapper } from '../mappers/prisma-user.mapper';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    const raw = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!raw) return null;

    return PrismaUserMapper.toDomain(raw);
  }

  async findByEmail(email: string): Promise<User | null> {
    const raw = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!raw) return null;

    return PrismaUserMapper.toDomain(raw);
  }

  async findByResetPasswordTokenHash(tokenHash: string): Promise<User | null> {
    const raw = await this.prisma.user.findFirst({
      where: {
        resetPasswordTokenHash: tokenHash,
        resetPasswordExpiresAt: {
          gt: new Date(),
        },
      },
    });

    if (!raw) return null;

    return PrismaUserMapper.toDomain(raw);
  }

  async create(user: User): Promise<User> {
    const raw = await this.prisma.user.create({
      data: PrismaUserMapper.toPrisma(user),
    });

    return PrismaUserMapper.toDomain(raw);
  }

  async save(user: User): Promise<User> {
    const raw = await this.prisma.user.update({
      where: { id: user.id },
      data: PrismaUserMapper.toPrismaUpdate(user),
    });

    return PrismaUserMapper.toDomain(raw);
  }
}
