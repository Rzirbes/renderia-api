import { Injectable } from '@nestjs/common';
import { Prisma, Render, RenderEventType, RenderStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma/prisma.service';
import { CreateRenderDto } from './dto/create-render.dto';
import { ListRendersDto } from './dto/list-renders.dto';
import { PaginatedResult } from '../../common/pagination/paginated-result';

type FailReason = {
  code?: string;
  message: string;
  meta?: unknown;
};

@Injectable()
export class RendersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateRenderDto): Promise<Render> {
    if (dto.clientRequestId) {
      const existing = await this.prisma.render.findFirst({
        where: { userId, clientRequestId: dto.clientRequestId },
      });
      if (existing) return existing;
    }

    return this.prisma.render.create({
      data: {
        userId,
        originalImageUrl: dto.originalImageUrl,
        prompt: dto.prompt ?? null,
        creditsUsed: dto.creditsToUse ?? 0,
        clientRequestId: dto.clientRequestId ?? null,
        status: RenderStatus.PENDING,
        generatedImageUrl: null,
        events: {
          create: {
            type: RenderEventType.CREATED,
            fromStatus: null,
            toStatus: RenderStatus.PENDING,
            message: 'Render criado',
          },
        },
      },
    });
  }

  async list(
    userId: string,
    query: ListRendersDto,
  ): Promise<PaginatedResult<Render>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;

    const where = { userId };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.render.count({ where }),
      this.prisma.render.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { items, page, pageSize, total };
  }

  async findById(userId: string, id: string): Promise<Render | null> {
    return this.prisma.render.findFirst({ where: { id, userId } });
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const res = await this.prisma.render.deleteMany({ where: { id, userId } });
    return res.count > 0;
  }

  /**
   * Enfileira/começa: PENDING -> PROCESSING
   * Idempotente: se não mudar nada, só retorna o estado atual.
   */
  async process(userId: string, id: string): Promise<Render | null> {
    const now = new Date();

    // tenta transicionar PENDING -> PROCESSING de forma atômica
    const res = await this.prisma.render.updateMany({
      where: { id, userId, status: RenderStatus.PENDING },
      data: {
        status: RenderStatus.PROCESSING,
        startedAt: now,

        // limpando erro anterior, caso reprocessar vire algo no futuro
        failedAt: null,
        errorCode: null,
        errorMessage: null,
        errorMeta: Prisma.DbNull,
      },
    });

    // se mudou, registra evento
    if (res.count > 0) {
      await this.prisma.renderEvent.create({
        data: {
          renderId: id,
          type: RenderEventType.PROCESSING_STARTED,
          fromStatus: RenderStatus.PENDING,
          toStatus: RenderStatus.PROCESSING,
          message: 'Processamento iniciado',
          meta: { at: now.toISOString() },
        },
      });
    }

    return this.prisma.render.findFirst({ where: { id, userId } });
  }

  /**
   * Worker fake: PROCESSING -> DONE
   */
  async complete(userId: string, id: string): Promise<Render | null> {
    const now = new Date();
    const fakeGeneratedUrl = `https://fake-cdn.renderia.local/renders/${id}.png`;

    const res = await this.prisma.render.updateMany({
      where: { id, userId, status: RenderStatus.PROCESSING },
      data: {
        status: RenderStatus.DONE,
        generatedImageUrl: fakeGeneratedUrl,
        completedAt: now,

        // garantia: ao completar, remove erro
        failedAt: null,
        errorCode: null,
        errorMessage: null,
        errorMeta: Prisma.DbNull,
      },
    });

    if (res.count > 0) {
      await this.prisma.renderEvent.create({
        data: {
          renderId: id,
          type: RenderEventType.COMPLETED,
          fromStatus: RenderStatus.PROCESSING,
          toStatus: RenderStatus.DONE,
          message: 'Render finalizado com sucesso',
          meta: { generatedImageUrl: fakeGeneratedUrl, at: now.toISOString() },
        },
      });
    }

    return this.prisma.render.findFirst({ where: { id, userId } });
  }

  /**
   * Worker fake: PROCESSING -> ERROR (com motivo)
   */
  async fail(
    userId: string,
    id: string,
    reason: FailReason,
  ): Promise<Render | null> {
    const now = new Date();

    const res = await this.prisma.render.updateMany({
      where: { id, userId, status: RenderStatus.PROCESSING },
      data: {
        status: RenderStatus.ERROR,
        failedAt: now,
        errorCode: reason.code ?? 'UNKNOWN_ERROR',
        errorMessage: reason.message,
        errorMeta: Prisma.DbNull,
      },
    });

    if (res.count > 0) {
      await this.prisma.renderEvent.create({
        data: {
          renderId: id,
          type: RenderEventType.FAILED,
          fromStatus: RenderStatus.PROCESSING,
          toStatus: RenderStatus.ERROR,
          message: reason.message,
          meta: {
            code: reason.code ?? 'UNKNOWN_ERROR',
            at: now.toISOString(),
            details: reason.meta ?? null,
          },
        },
      });
    }

    return this.prisma.render.findFirst({ where: { id, userId } });
  }
}
