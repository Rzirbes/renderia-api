import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { CreditsService } from './credits.service';
import { JwtAuthGuard } from '../auth/infrastructure/guards/jwt.guard';
import { AddCreditsDto } from './dto/add-credits.dto';
import { UseCreditsDto } from './dto/use-credits.dto';
import { ListTxsDto } from './dto/list-txs.dto';

type JwtPayload = { userId: string; email: string };

@Controller('credits')
@UseGuards(JwtAuthGuard)
export class CreditsController {
  constructor(private readonly creditsService: CreditsService) {}

  @Get('me')
  me(@Req() req: Request & { user?: JwtPayload }) {
    return this.creditsService.getMe(req.user!.userId);
  }

  @Get('me/txs')
  listTxs(
    @Req() req: Request & { user?: JwtPayload },
    @Query() query: ListTxsDto,
  ) {
    return this.creditsService.listTxs(
      req.user!.userId,
      query.page ?? 1,
      query.pageSize ?? 20,
    );
  }

  @Post('me/add')
  add(@Req() req: Request & { user?: JwtPayload }, @Body() dto: AddCreditsDto) {
    return this.creditsService.addCredits({
      userId: req.user!.userId,
      amount: dto.amount,
      type: dto.type,
      meta: dto.meta,
    });
  }

  @Post('me/use')
  use(@Req() req: Request & { user?: JwtPayload }, @Body() dto: UseCreditsDto) {
    return this.creditsService.useCredits({
      userId: req.user!.userId,
      amount: dto.amount,
      meta: dto.meta,
    });
  }
}
