export type UserResponseDto = {
  id: string;
  name: string | null;
  email: string;
  credits: number;
  createdAt: string;
  updatedAt: string;
};

import type { User } from '@prisma/client';

export function toUserResponse(user: User): UserResponseDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    credits: user.credits,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
