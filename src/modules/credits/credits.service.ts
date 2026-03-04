import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, CreditTxType } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';

@Injectable()
export class CreditsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, credits: true },
    });

    if (!user) throw new NotFoundException('User not found');

    const lastTxs = await this.prisma.creditTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return {
      credits: user.credits,
      lastTxs,
    };
  }

  /**
   * Adiciona créditos ao usuário e registra transação.
   * use para BONUS / PURCHASE / REFUND
   */
  async addCredits(params: {
    userId: string;
    amount: number;
    type: CreditTxType;
    meta?: Prisma.InputJsonValue;
  }) {
    const { userId, amount, type, meta } = params;

    if (amount <= 0) throw new BadRequestException('amount must be > 0');

    // segurança: impedir usar addCredits com type USAGE por acidente
    if (type === CreditTxType.USAGE) {
      throw new BadRequestException('Use useCredits for USAGE');
    }

    const [user, tx] = await this.prisma.$transaction(async (trx) => {
      const updatedUser = await trx.user.update({
        where: { id: userId },
        data: { credits: { increment: amount } },
        select: { id: true, credits: true },
      });

      const createdTx = await trx.creditTransaction.create({
        data: {
          userId,
          type,
          amount, // positivo
          meta,
        },
      });

      return [updatedUser, createdTx] as const;
    });

    return { credits: user.credits, tx };
  }

  async useCredits(params: {
    userId: string;
    amount: number;
    meta?: Prisma.InputJsonValue;
  }) {
    const { userId, amount, meta } = params;

    if (amount <= 0) throw new BadRequestException('amount must be > 0');

    const result = await this.prisma.$transaction(async (trx) => {
      const updated = await trx.user.updateMany({
        where: {
          id: userId,
          credits: { gte: amount },
        },
        data: {
          credits: { decrement: amount },
        },
      });

      if (updated.count === 0) {
        throw new BadRequestException('Insufficient credits');
      }

      const user = await trx.user.findUnique({
        where: { id: userId },
        select: { id: true, credits: true },
      });

      if (!user) throw new NotFoundException('User not found');

      const tx = await trx.creditTransaction.create({
        data: {
          userId,
          type: CreditTxType.USAGE,
          amount: -amount,
          meta,
        },
      });

      return { credits: user.credits, tx };
    });

    return result;
  }

  async listTxs(userId: string, page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.creditTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.creditTransaction.count({
        where: { userId },
      }),
    ]);

    return {
      page,
      pageSize,
      total,
      items,
    };
  }
}
