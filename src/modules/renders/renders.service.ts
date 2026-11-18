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
import { enqueueRenderJob } from './renders.queue';
import { RENDER_PRESETS, RenderPresetId } from './render-presets';
import { EditRenderDto } from './dto/edit-render.dto';

type FailReason = {
  code?: string;
  message: string;
  meta?: Prisma.InputJsonValue;
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

/**
 * Resultado do claim atômico PENDING -> PROCESSING.
 *
 * Só `claimed` autoriza chamar o Gemini. Qualquer outro resultado significa
 * que outro executor já assumiu (ou concluiu) o render, ou que ele não pode
 * ser processado.
 */
export type ClaimResult =
  | { outcome: 'claimed'; render: Render }
  | { outcome: 'not-found' }
  | { outcome: 'not-pending'; render: Render }
  | { outcome: 'insufficient-credits'; render: Render };

export type FailResult = {
  /** true se ESTA chamada fez a transição PROCESSING -> ERROR. */
  failed: boolean;
  refundedCredits: number;
  render: Render | null;
};

export type CompleteResult = {
  /** true se ESTA chamada fez a transição PROCESSING -> DONE. */
  completed: boolean;
  render: Render | null;
};

export const INSUFFICIENT_CREDITS_MESSAGE = 'Insufficient credits';

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

  /**
   * Verificação antecipada (não vinculante) de saldo, apenas para UX: evita
   * criar/enfileirar render que certamente falharia. A garantia real de saldo
   * é o débito condicional dentro de `claimForProcessing`.
   */
  private async assertHasCredits(userId: string, cost: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });

    if (!user || user.credits < cost) {
      throw new BadRequestException(INSUFFICIENT_CREDITS_MESSAGE);
    }
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

    await this.assertHasCredits(userId, this.getCreditsCost({ presetId }));

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

    await this.enqueue(render);

    return render;
  }

  /**
   * Enfileira um render PENDING de forma idempotente (jobId = renderId).
   * Falha de enfileiramento não perde o render: ele continua PENDING, o
   * evento é registrado e a recuperação periódica (`requeuePendings`) tenta
   * de novo.
   */
  async enqueue(render: Pick<Render, 'id' | 'userId'>): Promise<boolean> {
    try {
      await enqueueRenderJob({ renderId: render.id, userId: render.userId });
      return true;
    } catch (err: unknown) {
      const e = normalizeError(err);

      this.logger.warn(
        `Queue enqueue failed for render=${render.id}: ${e.message}`,
      );

      await this.prisma.renderEvent.create({
        data: {
          renderId: render.id,
          type: RenderEventType.QUEUE_ENQUEUE_FAILED,
          fromStatus: RenderStatus.PENDING,
          toStatus: RenderStatus.PENDING,
          message: 'Falha ao enfileirar; será reprocessado automaticamente',
          meta: {
            at: new Date().toISOString(),
            error: {
              message: e.message,
              code: e.code,
              name: e.name,
            },
          },
        },
      });

      return false;
    }
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
   * Claim atômico PENDING -> PROCESSING com débito de créditos, numa única
   * transação. É o ÚNICO ponto que autoriza uma chamada ao Gemini.
   *
   * Concorrência: o `updateMany ... WHERE status = PENDING` adquire o lock da
   * linha. Uma transação concorrente bloqueia nesse UPDATE e, quando a
   * primeira confirma, o PostgreSQL reavalia o WHERE (READ COMMITTED) e
   * atualiza 0 linhas. Assim só um executor recebe `claimed` e só um débito
   * é feito, independentemente de quantos workers/requisições/retries
   * chegarem ao mesmo tempo.
   */
  async claimForProcessing(userId: string, id: string): Promise<ClaimResult> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const render = await tx.render.findFirst({ where: { id, userId } });

      if (!render) {
        return { outcome: 'not-found' as const };
      }

      if (render.status !== RenderStatus.PENDING) {
        return { outcome: 'not-pending' as const, render };
      }

      const creditsToUse = this.getCreditsCost(render);

      const claimed = await tx.render.updateMany({
        where: { id, userId, status: RenderStatus.PENDING },
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

      if (claimed.count === 0) {
        // Outro executor fez o claim entre a leitura e o UPDATE.
        const current = await tx.render.findFirst({ where: { id, userId } });
        if (!current) return { outcome: 'not-found' as const };
        return { outcome: 'not-pending' as const, render: current };
      }

      const debited = await tx.user.updateMany({
        where: { id: userId, credits: { gte: creditsToUse } },
        data: { credits: { decrement: creditsToUse } },
      });

      if (debited.count === 0) {
        // Sem saldo: estado terminal, nada cobrado, Gemini não é chamado.
        const failedRender = await tx.render.update({
          where: { id },
          data: {
            status: RenderStatus.ERROR,
            creditsUsed: 0,
            failedAt: now,
            errorCode: 'INSUFFICIENT_CREDITS',
            errorMessage: 'Créditos insuficientes para processar o render.',
          },
        });

        await tx.renderEvent.create({
          data: {
            renderId: id,
            type: RenderEventType.FAILED,
            fromStatus: RenderStatus.PENDING,
            toStatus: RenderStatus.ERROR,
            message: 'Créditos insuficientes',
            meta: { code: 'INSUFFICIENT_CREDITS', at: now.toISOString() },
          },
        });

        return {
          outcome: 'insufficient-credits' as const,
          render: failedRender,
        };
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

      const updated = await tx.render.findFirst({ where: { id, userId } });
      return { outcome: 'claimed' as const, render: updated ?? render };
    });
  }

  /**
   * PROCESSING -> DONE, condicional. Só deve ser chamado depois que a imagem
   * gerada foi validada e persistida no storage.
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
  ): Promise<CompleteResult> {
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

      return {
        completed: res.count > 0,
        render: await tx.render.findFirst({ where: { id, userId } }),
      };
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

    await this.assertHasCredits(
      userId,
      this.getCreditsCost({ parentRenderId: render.id }),
    );

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
        events: {
          create: {
            type: 'CREATED',
            toStatus: 'PENDING',
            message: 'Render criado a partir da edição de um render anterior.',
            meta: {
              parentRenderId: render.id,
              editedFromRenderId: render.id,
            },
          },
        },
      },
    });

    // Edições também são processadas exclusivamente pelo worker.
    await this.enqueue(newRender);

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
        const result = await enqueueRenderJob({
          renderId: r.id,
          userId: r.userId,
        });

        if (result === 'already-queued') {
          alreadyQueued++;
          continue;
        }

        enqueued++;

        await this.prisma.renderEvent.create({
          data: {
            renderId: r.id,
            type: RenderEventType.REQUEUED,
            fromStatus: RenderStatus.PENDING,
            toStatus: RenderStatus.PENDING,
            message: `Reenfileirado automaticamente (PENDING > ${cutoffMinutes}min)`,
            meta: {
              at: now.toISOString(),
              cutoffMinutes,
              createdAt: r.createdAt.toISOString(),
              result,
            },
          },
        });
      } catch (err: unknown) {
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
   * PROCESSING -> ERROR com reembolso integral dos créditos debitados no
   * claim, na MESMA transação da mudança de status.
   *
   * O reembolso só acontece se esta chamada fizer a transição condicional;
   * chamadas concorrentes/repetidas (worker + recuperação de travados, retry)
   * atualizam 0 linhas e não reembolsam de novo. `creditsUsed` é zerado, o
   * que reflete o custo líquido do render e serve de trava adicional.
   */
  async failProcessing(
    userId: string,
    id: string,
    reason: FailReason,
  ): Promise<FailResult> {
    const now = new Date();
    const code = reason.code ?? 'UNKNOWN_ERROR';

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.render.findFirst({ where: { id, userId } });

      if (!current || current.status !== RenderStatus.PROCESSING) {
        return { failed: false, refundedCredits: 0, render: current };
      }

      const res = await tx.render.updateMany({
        where: { id, userId, status: RenderStatus.PROCESSING },
        data: {
          status: RenderStatus.ERROR,
          failedAt: now,
          errorCode: code,
          errorMessage: reason.message,
          errorMeta: reason.meta ?? Prisma.DbNull,
          creditsUsed: 0,
        },
      });

      if (res.count === 0) {
        return {
          failed: false,
          refundedCredits: 0,
          render: await tx.render.findFirst({ where: { id, userId } }),
        };
      }

      const refundedCredits = Math.max(current.creditsUsed, 0);

      if (refundedCredits > 0) {
        await tx.user.update({
          where: { id: userId },
          data: { credits: { increment: refundedCredits } },
        });

        await tx.creditTransaction.create({
          data: {
            userId,
            type: CreditTxType.REFUND,
            amount: refundedCredits,
            meta: { renderId: id, reason: code },
          },
        });
      }

      await tx.renderEvent.create({
        data: {
          renderId: id,
          type: RenderEventType.FAILED,
          fromStatus: RenderStatus.PROCESSING,
          toStatus: RenderStatus.ERROR,
          message: reason.message,
          meta: {
            code,
            at: now.toISOString(),
            refundedCredits,
            details: reason.meta ?? null,
          },
        },
      });

      return {
        failed: true,
        refundedCredits,
        render: await tx.render.findFirst({ where: { id, userId } }),
      };
    });
  }

  /**
   * Recupera renders presos em PROCESSING (ex.: o processo do worker morreu
   * durante a chamada ao Gemini). Eles NÃO são reexecutados — não há como
   * saber se o Gemini já foi cobrado/respondeu — e sim marcados como ERROR
   * com reembolso. `olderThanMinutes` deve ser bem maior que o timeout do
   * Gemini para não interromper um processamento ainda vivo.
   */
  async recoverStaleProcessing(
    olderThanMinutes: number,
    limit = 50,
  ): Promise<{ found: number; recovered: number }> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);

    const stale = await this.prisma.render.findMany({
      where: { status: RenderStatus.PROCESSING, startedAt: { lte: cutoff } },
      orderBy: { startedAt: 'asc' },
      take: limit,
      select: { id: true, userId: true },
    });

    let recovered = 0;
    for (const r of stale) {
      const result = await this.failProcessing(r.userId, r.id, {
        code: 'PROCESSING_TIMEOUT',
        message:
          'O processamento não foi concluído a tempo. Os créditos foram devolvidos.',
      });
      if (result.failed) recovered++;
    }

    if (recovered > 0) {
      this.logger.warn(`Recovered ${recovered} stale PROCESSING render(s)`);
    }

    return { found: stale.length, recovered };
  }
}
