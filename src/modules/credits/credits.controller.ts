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
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
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

  // SEGURANÇA: não existe rota HTTP para adicionar créditos.
  // O antigo `POST /credits/me/add` deixava qualquer usuário autenticado
  // aumentar o próprio saldo sem limite. Créditos (BONUS/PURCHASE/REFUND)
  // só podem ser concedidos por código do servidor via
  // `CreditsService.addCredits` (ex.: um futuro webhook de pagamento
  // verificado ou um script operacional executado fora da API pública).

  @Post('me/use')
  use(@Req() req: Request & { user?: JwtPayload }, @Body() dto: UseCreditsDto) {
    return this.creditsService.useCredits({
      userId: req.user!.userId,
      amount: dto.amount,
      meta: dto.meta,
    });
  }
}
