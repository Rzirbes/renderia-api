import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AuthUser } from '../types/auth-user.type';

type RequestWithUser = Request & { user?: AuthUser };

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();

    if (!req.user) {
      throw new Error('Missing req.user (did you forget JwtAuthGuard?)');
    }

    return req.user;
  },
);
