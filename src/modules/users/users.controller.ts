import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';

import { JwtAuthGuard } from '../auth/infrastructure/guards/jwt.guard';
import { UsersService } from './users.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { toUserResponse } from './dto/user-response.dto';

type JwtPayload = { userId: string; email: string };

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async me(@Req() req: Request & { user?: JwtPayload }) {
    const user = await this.usersService.findById(req.user!.userId);
    return toUserResponse(user);
  }

  @Patch('me')
  async updateMe(
    @Req() req: Request & { user?: JwtPayload },
    @Body() dto: UpdateMeDto,
  ) {
    const user = await this.usersService.updateMe(req.user!.userId, dto);
    return toUserResponse(user);
  }
}
