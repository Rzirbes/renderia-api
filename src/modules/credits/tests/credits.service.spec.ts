import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CreditTxType, Prisma } from '@prisma/client';

import { CreditsService } from '../credits.service';
import { PrismaService } from '../../../database/prisma/prisma.service';

function makePrismaMock() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    creditTransaction: {
      findMany: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  return prisma;
}

type TxCallback<T> = (trx: any) => Promise<T> | T;

describe('CreditsService', () => {
  let service: CreditsService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const moduleRef = await Test.createTestingModule({
      providers: [CreditsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(CreditsService);
    jest.clearAllMocks();
  });

  describe('addCredits', () => {
    it('should increment credits and create transaction', async () => {
      prisma.$transaction.mockImplementation(async <T>(fn: TxCallback<T>) => {
        // simula o trx que o callback recebe
        const trx = {
          user: { update: prisma.user.update },
          creditTransaction: { create: prisma.creditTransaction.create },
        };
        return fn(trx);
      });

      prisma.user.update.mockResolvedValue({ id: 'u1', credits: 15 });
      prisma.creditTransaction.create.mockResolvedValue({
        id: 'tx1',
        userId: 'u1',
        type: CreditTxType.BONUS,
        amount: 10,
        meta: { reason: 'test' } as Prisma.InputJsonValue,
        createdAt: new Date(),
      });

      const res = await service.addCredits({
        userId: 'u1',
        amount: 10,
        type: CreditTxType.BONUS,
        meta: { reason: 'test' } as Prisma.InputJsonValue,
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { credits: { increment: 10 } },
        select: { id: true, credits: true },
      });

      expect(prisma.creditTransaction.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          type: CreditTxType.BONUS,
          amount: 10,
          meta: { reason: 'test' },
        },
      });

      expect(res.credits).toBe(15);
      expect(res.tx.id).toBe('tx1');
    });

    it('should throw if amount <= 0', async () => {
      await expect(
        service.addCredits({
          userId: 'u1',
          amount: 0,
          type: CreditTxType.BONUS,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should throw if type is USAGE', async () => {
      await expect(
        service.addCredits({
          userId: 'u1',
          amount: 10,
          type: CreditTxType.USAGE,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('useCredits', () => {
    it('should decrement credits and create USAGE transaction', async () => {
      prisma.$transaction.mockImplementation(async <T>(fn: TxCallback<T>) => {
        const trx = {
          user: {
            updateMany: prisma.user.updateMany,
            findUnique: prisma.user.findUnique,
          },
          creditTransaction: {
            create: prisma.creditTransaction.create,
          },
        };
        return fn(trx);
      });

      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', credits: 7 });
      prisma.creditTransaction.create.mockResolvedValue({
        id: 'tx2',
        userId: 'u1',
        type: CreditTxType.USAGE,
        amount: -3,
        meta: { renderId: 'r1' } as Prisma.InputJsonValue,
        createdAt: new Date(),
      });

      const res = await service.useCredits({
        userId: 'u1',
        amount: 3,
        meta: { renderId: 'r1' } as Prisma.InputJsonValue,
      });

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'u1', credits: { gte: 3 } },
        data: { credits: { decrement: 3 } },
      });

      expect(prisma.creditTransaction.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          type: CreditTxType.USAGE,
          amount: -3,
          meta: { renderId: 'r1' },
        },
      });

      expect(res.credits).toBe(7);
      expect(res.tx.amount).toBe(-3);
    });

    it('should throw if insufficient credits', async () => {
      prisma.$transaction.mockImplementation(async <T>(fn: TxCallback<T>) => {
        const trx = {
          user: { updateMany: prisma.user.updateMany },
          creditTransaction: { create: prisma.creditTransaction.create },
        };
        return fn(trx);
      });

      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.useCredits({ userId: 'u1', amount: 3 }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.creditTransaction.create).not.toHaveBeenCalled();
    });

    it('should throw if user not found after decrement', async () => {
      prisma.$transaction.mockImplementation(async <T>(fn: TxCallback<T>) => {
        const trx = {
          user: {
            updateMany: prisma.user.updateMany,
            findUnique: prisma.user.findUnique,
          },
          creditTransaction: { create: prisma.creditTransaction.create },
        };
        return fn(trx);
      });

      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.useCredits({ userId: 'u1', amount: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should throw if amount <= 0', async () => {
      await expect(
        service.useCredits({ userId: 'u1', amount: 0 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getMe', () => {
    it('should return credits and last transactions', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', credits: 12 });
      prisma.creditTransaction.findMany.mockResolvedValue([
        { id: 'tx1' },
        { id: 'tx2' },
      ]);

      const res = await service.getMe('u1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'u1' },
        select: { id: true, credits: true },
      });

      expect(prisma.creditTransaction.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      expect(res.credits).toBe(12);
      expect(res.lastTxs).toHaveLength(2);
    });

    it('should throw if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getMe('u1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('listTxs', () => {
    it('should return paginated transactions and total', async () => {
      const items = [{ id: 'tx1' }, { id: 'tx2' }];

      prisma.$transaction.mockResolvedValue([items, 42]);

      const res = await service.listTxs('u1', 2, 20);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      expect(res.page).toBe(2);
      expect(res.pageSize).toBe(20);
      expect(res.total).toBe(42);
      expect(res.items).toEqual(items);
    });
  });
});
