import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthUser } from '../../../modules/auth/infrastructure/types/authenticated-user.type';

type RequestWithUser = Request & { user?: AuthUser };

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();

    if (!req.user) {
      throw new UnauthorizedException(
        'Missing authenticated user (JwtAuthGuard required)',
      );
    }
    return req.user;
  },
);
