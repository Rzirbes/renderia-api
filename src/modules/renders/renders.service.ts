import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  Render,
  RenderEventType,
  RenderStatus,
  CreditTxType,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma/prisma.service';
import { CreateRenderDto } from './dto/create-render.dto';
import { ListRendersDto } from './dto/list-renders.dto';
import { PaginatedResult } from '../../common/pagination/paginated-result';
import { rendersQueue } from './renders.queue';
import { RENDER_PRESETS, RenderPresetId } from './render-presets';
import { EditRenderDto } from './dto/edit-render.dto';

type FailReason = {
  code?: string;
  message: string;
  meta?: unknown;
};

type NormalizedError = {
  message: string;
  name: string | null;
  code: string | null;
};

type RequeueResult = {
  cutoffMinutes: number;
  found: number;
  enqueued: number;
  alreadyQueued: number;
  failed: number;
};

function isJobAlreadyExistsError(err: unknown): boolean {
  const e = normalizeError(err);
  const msg = e.message.toLowerCase();

  // BullMQ costuma lançar algo nessa linha quando jobId duplica
  return msg.includes('already exists') || msg.includes('exists');
}

function normalizeError(err: unknown): NormalizedError {
  // Error padrão (throw new Error)
  if (err instanceof Error) {
    // Alguns libs jogam "code" no objeto Error
    const maybe = err as Error & { code?: unknown };
    return {
      message: err.message || 'UNKNOWN_ERROR',
      name: err.name || null,
      code:
        typeof maybe.code === 'string' || typeof maybe.code === 'number'
          ? String(maybe.code)
          : null,
    };
  }

  // throw "string"
  if (typeof err === 'string') {
    return { message: err, name: null, code: null };
  }

  // throw { message, code, name }
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>;

    const message =
      typeof obj.message === 'string'
        ? obj.message
        : typeof obj.error === 'string'
          ? obj.error
          : 'UNKNOWN_ERROR';

    const name = typeof obj.name === 'string' ? obj.name : null;

    const code =
      typeof obj.code === 'string' || typeof obj.code === 'number'
        ? String(obj.code)
        : null;

    return { message, name, code };
  }

  return { message: 'UNKNOWN_ERROR', name: null, code: null };
}

@Injectable()
export class RendersService {
  private readonly logger = new Logger(RendersService.name);

  constructor(private readonly prisma: PrismaService) {}

  private getCreditsCost(render: {
    parentRenderId?: string | null;
    presetId?: string | null;
  }): number {
    if (render.parentRenderId) {
      return 1;
    }

    return 1;
  }

  async create(
    userId: string,
    dto: CreateRenderDto,
    originalImage: {
      url: string;
      path: string;
      mimeType: string;
    },
  ): Promise<Render> {
    if (dto.clientRequestId) {
      const existing = await this.prisma.render.findFirst({
        where: { userId, clientRequestId: dto.clientRequestId },
      });

      if (existing) return existing;
    }

    const presetId: RenderPresetId = dto.presetId ?? 'daylight_9am';
    const preset = RENDER_PRESETS[presetId];

    const render = await this.prisma.render.create({
      data: {
        userId,
        originalImageUrl: originalImage.url,
        originalImagePath: originalImage.path,
        sourceImageMimeType: originalImage.mimeType,
        prompt: dto.prompt ?? null,
        presetId,
        creditsUsed: 0,
        clientRequestId: dto.clientRequestId ?? null,
        status: RenderStatus.PENDING,
        generatedImageUrl: null,
        generatedImagePath: null,
        providerModel: null,
        outputImageMimeType: null,
        events: {
          create: {
            type: RenderEventType.CREATED,
            fromStatus: null,
            toStatus: RenderStatus.PENDING,
            message: `Render criado com preset ${preset.label}`,
          },
        },
      },
    });

    try {
      await rendersQueue.add(
        'render-job',
        { renderId: render.id, userId },
        {
          jobId: render.id,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );
    } catch (err: unknown) {
      const e = normalizeError(err);

      this.logger.warn(
        `Queue enqueue failed for render=${render.id}: ${e.message}`,
      );

      const meta: Prisma.InputJsonObject = {
        at: new Date().toISOString(),
        error: {
          message: e.message,
          code: e.code,
          name: e.name,
        },
      };

      await this.prisma.renderEvent.create({
        data: {
          renderId: render.id,
          type: RenderEventType.QUEUE_ENQUEUE_FAILED,
          fromStatus: RenderStatus.PENDING,
          toStatus: RenderStatus.PENDING,
          message: 'Falha ao enfileirar; será reprocessado automaticamente',
          meta,
        },
      });
    }

    return render;
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

    return this.prisma.$transaction(async (tx) => {
      const render = await tx.render.findFirst({
        where: { id, userId },
      });

      if (!render) {
        return null;
      }

      if (render.status !== RenderStatus.PENDING) {
        return render;
      }

      const creditsToUse = this.getCreditsCost(render);

      const updatedUser = await tx.user.updateMany({
        where: {
          id: userId,
          credits: { gte: creditsToUse },
        },
        data: {
          credits: { decrement: creditsToUse },
        },
      });

      if (updatedUser.count === 0) {
        throw new BadRequestException('Insufficient credits');
      }

      await tx.creditTransaction.create({
        data: {
          userId,
          type: CreditTxType.USAGE,
          amount: -creditsToUse,
          meta: {
            renderId: render.id,
            action: render.parentRenderId ? 'EDIT_RENDER' : 'CREATE_RENDER',
            presetId: render.presetId,
          },
        },
      });

      await tx.render.update({
        where: { id: render.id },
        data: {
          status: RenderStatus.PROCESSING,
          startedAt: now,
          failedAt: null,
          errorCode: null,
          errorMessage: null,
          errorMeta: Prisma.DbNull,
          creditsUsed: creditsToUse,
        },
      });

      await tx.renderEvent.create({
        data: {
          renderId: id,
          type: RenderEventType.PROCESSING_STARTED,
          fromStatus: RenderStatus.PENDING,
          toStatus: RenderStatus.PROCESSING,
          message: 'Processamento iniciado',
          meta: {
            at: now.toISOString(),
            creditsUsed: creditsToUse,
          },
        },
      });

      return tx.render.findFirst({ where: { id, userId } });
    });
  }

  /**
   * Worker fake: PROCESSING -> DONE
   */
  /*  async complete(
    userId: string,
    id: string,
    generatedImage: {
      url: string;
      path: string;
      mimeType: string;
    },
  ): Promise<Render | null> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const res = await tx.render.updateMany({
        where: { id, userId, status: RenderStatus.PROCESSING },
        data: {
          status: RenderStatus.DONE,
          generatedImageUrl: generatedImage.url,
          generatedImagePath: generatedImage.path,
          outputImageMimeType: generatedImage.mimeType,
          completedAt: now,
          failedAt: null,
          errorCode: null,
          errorMessage: null,
          errorMeta: Prisma.DbNull,
        },
      });

      if (res.count > 0) {
        await tx.renderEvent.create({
          data: {
            renderId: id,
            type: RenderEventType.COMPLETED,
            fromStatus: RenderStatus.PROCESSING,
            toStatus: RenderStatus.DONE,
            message: 'Render finalizado com sucesso',
            meta: {
              generatedImageUrl: generatedImage.url,
              generatedImagePath: generatedImage.path,
              outputImageMimeType: generatedImage.mimeType,
              at: now.toISOString(),
            },
          },
        });
      }

      return tx.render.findFirst({ where: { id, userId } });
    });
  }
*/
  async markAsDone(
    userId: string,
    id: string,
    payload: {
      generatedImageUrl: string;
      generatedImagePath: string;
      outputImageMimeType: string;
      sourceImageMimeType?: string | null;
      providerModel?: string | null;
    },
  ): Promise<Render | null> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const res = await tx.render.updateMany({
        where: { id, userId, status: RenderStatus.PROCESSING },
        data: {
          status: RenderStatus.DONE,
          generatedImageUrl: payload.generatedImageUrl,
          generatedImagePath: payload.generatedImagePath,
          outputImageMimeType: payload.outputImageMimeType,
          sourceImageMimeType: payload.sourceImageMimeType ?? undefined,
          providerModel: payload.providerModel ?? null,
          completedAt: now,
          failedAt: null,
          errorCode: null,
          errorMessage: null,
          errorMeta: Prisma.DbNull,
        },
      });

      if (res.count > 0) {
        await tx.renderEvent.create({
          data: {
            renderId: id,
            type: RenderEventType.COMPLETED,
            fromStatus: RenderStatus.PROCESSING,
            toStatus: RenderStatus.DONE,
            message: 'Render finalizado com sucesso',
            meta: {
              generatedImageUrl: payload.generatedImageUrl,
              generatedImagePath: payload.generatedImagePath,
              outputImageMimeType: payload.outputImageMimeType,
              sourceImageMimeType: payload.sourceImageMimeType ?? null,
              providerModel: payload.providerModel ?? null,
              at: now.toISOString(),
            },
          },
        });
      }

      return tx.render.findFirst({ where: { id, userId } });
    });
  }
  async editRender(userId: string, renderId: string, dto: EditRenderDto) {
    const render = await this.prisma.render.findFirst({
      where: {
        id: renderId,
        userId,
      },
    });

    if (!render) {
      throw new NotFoundException('Render não encontrado.');
    }

    if (render.status !== 'DONE') {
      throw new BadRequestException(
        'Apenas renders concluídos podem ser editados.',
      );
    }

    if (
      !render.generatedImageUrl ||
      !render.generatedImagePath ||
      !render.outputImageMimeType
    ) {
      throw new BadRequestException(
        'Este render não possui imagem gerada válida para servir como base da edição.',
      );
    }

    const newRender = await this.prisma.render.create({
      data: {
        userId,
        parentRenderId: render.id,
        status: 'PENDING',
        prompt: dto.prompt ?? render.prompt,
        presetId: dto.presetId ?? render.presetId,
        originalImageUrl: render.generatedImageUrl,
        originalImagePath: render.generatedImagePath,
        sourceImageMimeType: render.outputImageMimeType,
        creditsUsed: 0,
      },
    });

    await this.prisma.renderEvent.create({
      data: {
        renderId: newRender.id,
        type: 'CREATED',
        toStatus: 'PENDING',
        message: 'Render criado a partir da edição de um render anterior.',
        meta: {
          parentRenderId: render.id,
          editedFromRenderId: render.id,
        },
      },
    });

    return newRender;
  }

  async requeuePendings(cutoffMinutes = 2, limit = 50): Promise<RequeueResult> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - cutoffMinutes * 60 * 1000);

    const pendings = await this.prisma.render.findMany({
      where: {
        status: RenderStatus.PENDING,
        createdAt: { lte: cutoff },
        startedAt: null, // opcional (recomendado)
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, userId: true, createdAt: true },
    });

    let enqueued = 0;
    let alreadyQueued = 0;
    let failed = 0;

    for (const r of pendings) {
      try {
        await rendersQueue.add(
          'render-job',
          { renderId: r.id, userId: r.userId },
          {
            jobId: r.id,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
          },
        );

        enqueued++;

        // se você tiver o enum REQUEUED no Prisma, usa ele.
        // se não tiver, pode comentar isso ou reaproveitar outro tipo.
        await this.prisma.renderEvent.create({
          data: {
            renderId: r.id,
            type: RenderEventType.REQUEUED, // <- precisa existir no enum
            fromStatus: RenderStatus.PENDING,
            toStatus: RenderStatus.PENDING,
            message: `Reenfileirado automaticamente (PENDING > ${cutoffMinutes}min)`,
            meta: {
              at: now.toISOString(),
              cutoffMinutes,
              createdAt: r.createdAt.toISOString(),
            },
          },
        });
      } catch (err: unknown) {
        if (isJobAlreadyExistsError(err)) {
          alreadyQueued++;
          continue;
        }

        failed++;
        const e = normalizeError(err);

        this.logger.warn(`Requeue failed for render=${r.id}: ${e.message}`);

        await this.prisma.renderEvent.create({
          data: {
            renderId: r.id,
            type: RenderEventType.QUEUE_ENQUEUE_FAILED,
            fromStatus: RenderStatus.PENDING,
            toStatus: RenderStatus.PENDING,
            message: 'Falha ao reenfileirar; tentará novamente',
            meta: {
              at: new Date().toISOString(),
              error: { message: e.message, code: e.code, name: e.name },
            },
          },
        });
      }
    }

    return {
      cutoffMinutes,
      found: pendings.length,
      enqueued,
      alreadyQueued,
      failed,
    };
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

    return this.prisma.$transaction(async (tx) => {
      const res = await tx.render.updateMany({
        where: { id, userId, status: RenderStatus.PROCESSING },
        data: {
          status: RenderStatus.ERROR,
          failedAt: now,
          errorCode: reason.code ?? 'UNKNOWN_ERROR',
          errorMessage: reason.message,
          errorMeta: reason.meta ?? Prisma.DbNull,
        },
      });

      if (res.count > 0) {
        await tx.renderEvent.create({
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

      return tx.render.findFirst({ where: { id, userId } });
    });
  }
}
