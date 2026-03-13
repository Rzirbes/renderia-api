import { User as PrismaUser, Prisma } from '@prisma/client';
import { User } from 'src/modules/auth/domain/entities/auth-user.entity';

export class PrismaUserMapper {
  static toDomain(raw: PrismaUser): User {
    return new User(
      raw.id,
      raw.name,
      raw.email,
      raw.password,
      raw.credits,
      raw.resetPasswordTokenHash,
      raw.resetPasswordExpiresAt,
      raw.createdAt,
      raw.updatedAt,
    );
  }

  static toPrisma(user: User): Prisma.UserUncheckedCreateInput {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      password: user.passwordHash,
      credits: user.credits,
      resetPasswordTokenHash: user.resetPasswordTokenHash,
      resetPasswordExpiresAt: user.resetPasswordExpiresAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  static toPrismaUpdate(user: User): Prisma.UserUncheckedUpdateInput {
    return {
      name: user.name,
      email: user.email,
      password: user.passwordHash,
      credits: user.credits,
      resetPasswordTokenHash: user.resetPasswordTokenHash,
      resetPasswordExpiresAt: user.resetPasswordExpiresAt,
      updatedAt: user.updatedAt,
    };
  }
}
