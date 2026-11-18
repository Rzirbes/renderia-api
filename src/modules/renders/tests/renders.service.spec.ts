jest.mock('../renders.queue', () => ({
  rendersQueue: { add: jest.fn() },
  enqueueRenderJob: jest.fn(),
  removeRenderJob: jest.fn(),
}));

import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, RenderEventType, RenderStatus } from '@prisma/client';

import { RendersService } from '../renders.service';
import { enqueueRenderJob, removeRenderJob } from '../renders.queue';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { RENDER_ID, USER_A } from './sandbox.helper-spec';

const enqueueMock = enqueueRenderJob as jest.MockedFunction<
  typeof enqueueRenderJob
>;
const removeJobMock = removeRenderJob as jest.MockedFunction<
  typeof removeRenderJob
>;

/**
 * Testes unitários (Prisma mockado) do fluxo de criação/enfileiramento.
 * A concorrência real (locks/transações) é coberta pelos testes de
 * integração em test/integration, contra um PostgreSQL descartável.
 */
describe('RendersService (unit)', () => {
  const prisma = {
    user: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    render: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    renderEvent: { create: jest.fn() },
    creditTransaction: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  let service: RendersService;

  const originalImage = {
    url: 'http://localhost:3000/uploads/originals/x.png',
    path: 'uploads/originals/x.png',
    mimeType: 'image/png',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(prisma),
    );
    service = new RendersService(prisma as unknown as PrismaService);
    prisma.render.create.mockResolvedValue({
      id: RENDER_ID,
      userId: USER_A,
      status: RenderStatus.PENDING,
    });
  });

  describe('create', () => {
    it('cria PENDING e enfileira exatamente um job (jobId = renderId), sem debitar', async () => {
      prisma.user.findUnique.mockResolvedValue({ credits: 5 });
      enqueueMock.mockResolvedValue('added');

      const { render, replayed } = await service.create(
        USER_A,
        { originalImagePath: originalImage.path },
        originalImage,
      );

      expect(render.id).toBe(RENDER_ID);
      expect(replayed).toBe(false);
      expect(enqueueMock).toHaveBeenCalledTimes(1);
      expect(enqueueMock).toHaveBeenCalledWith({
        renderId: RENDER_ID,
        userId: USER_A,
      });
      // Débito só acontece no claim do worker.
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.creditTransaction.create).not.toHaveBeenCalled();
    });

    it('sem créditos: 400 sem criar render nem enfileirar', async () => {
      prisma.user.findUnique.mockResolvedValue({ credits: 0 });

      await expect(
        service.create(
          USER_A,
          { originalImagePath: originalImage.path },
          originalImage,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.render.create).not.toHaveBeenCalled();
      expect(enqueueMock).not.toHaveBeenCalled();
    });

    it('falha de enfileiramento: render continua PENDING, evento registrado, sem erro ao cliente', async () => {
      prisma.user.findUnique.mockResolvedValue({ credits: 5 });
      enqueueMock.mockRejectedValue(new Error('ECONNREFUSED redis'));

      const { render } = await service.create(
        USER_A,
        { originalImagePath: originalImage.path },
        originalImage,
      );

      expect(render.status).toBe(RenderStatus.PENDING);
      expect(prisma.renderEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          renderId: RENDER_ID,
          type: RenderEventType.QUEUE_ENQUEUE_FAILED,
        }) as unknown,
      });
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    const existingFor = (over: Record<string, unknown> = {}) => ({
      id: RENDER_ID,
      userId: USER_A,
      status: RenderStatus.DONE,
      originalImagePath: originalImage.path,
      prompt: null,
      presetId: 'daylight_9am',
      clientRequestId: 'req-1',
      ...over,
    });

    it('clientRequestId repetido (mesmo payload) devolve o existente sem novo render, job ou débito', async () => {
      const existing = existingFor();
      prisma.render.findFirst.mockResolvedValue(existing);

      const res = await service.create(
        USER_A,
        { originalImagePath: originalImage.path, clientRequestId: 'req-1' },
        originalImage,
      );

      expect(res).toEqual({ render: existing, replayed: true });
      expect(prisma.render.findFirst).toHaveBeenCalledWith({
        where: { userId: USER_A, clientRequestId: 'req-1' },
      });
      expect(prisma.render.create).not.toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(enqueueMock).not.toHaveBeenCalled();
    });

    it('replay de render ainda PENDING garante o job (idempotente)', async () => {
      prisma.render.findFirst.mockResolvedValue(
        existingFor({ status: RenderStatus.PENDING }),
      );
      enqueueMock.mockResolvedValue('already-queued');

      const res = await service.create(
        USER_A,
        { originalImagePath: originalImage.path, clientRequestId: 'req-1' },
        originalImage,
      );

      expect(res.replayed).toBe(true);
      expect(enqueueMock).toHaveBeenCalledWith({
        renderId: RENDER_ID,
        userId: USER_A,
      });
      expect(prisma.render.create).not.toHaveBeenCalled();
    });

    type Change = {
      prompt?: string;
      presetId?: 'blue_hour';
      originalImagePath?: string;
    };
    it.each<[string, Change]>([
      ['prompt', { prompt: 'outro' }],
      ['preset', { presetId: 'blue_hour' }],
      ['imagem', { originalImagePath: 'uploads/originals/y.png' }],
    ])(
      'mesma chave com %s diferente: 409 IDEMPOTENCY_KEY_REUSED, nada criado',
      async (_label, change) => {
        prisma.render.findFirst.mockResolvedValue(existingFor());
        const img = {
          ...originalImage,
          path: change.originalImagePath ?? originalImage.path,
        };

        const err = await service
          .create(
            USER_A,
            {
              originalImagePath: img.path,
              clientRequestId: 'req-1',
              prompt: change.prompt,
              presetId: change.presetId,
            },
            img,
          )
          .catch((e: unknown) => e);

        expect(err).toBeInstanceOf(ConflictException);
        expect(
          ((err as ConflictException).getResponse() as { code: string }).code,
        ).toBe('IDEMPOTENCY_KEY_REUSED');
        expect(prisma.render.create).not.toHaveBeenCalled();
        expect(enqueueMock).not.toHaveBeenCalled();
      },
    );

    it('preset omitido equivale ao default (daylight_9am) na comparação', async () => {
      prisma.render.findFirst.mockResolvedValue(existingFor());

      const res = await service.create(
        USER_A,
        {
          originalImagePath: originalImage.path,
          clientRequestId: 'req-1',
          presetId: 'daylight_9am',
        },
        originalImage,
      );
      expect(res.replayed).toBe(true);
    });

    it('corrida: INSERT perde no UNIQUE (P2002) e devolve o vencedor sem enfileirar de novo', async () => {
      const winner = existingFor();
      prisma.render.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(winner);
      prisma.user.findUnique.mockResolvedValue({ credits: 5 });
      prisma.render.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );

      const res = await service.create(
        USER_A,
        { originalImagePath: originalImage.path, clientRequestId: 'req-1' },
        originalImage,
      );

      expect(res).toEqual({ render: winner, replayed: true });
      expect(enqueueMock).not.toHaveBeenCalled();
    });

    it('P2002 sem clientRequestId não é mascarado', async () => {
      prisma.user.findUnique.mockResolvedValue({ credits: 5 });
      const p2002 = new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'x',
      });
      prisma.render.create.mockRejectedValue(p2002);

      await expect(
        service.create(
          USER_A,
          { originalImagePath: originalImage.path },
          originalImage,
        ),
      ).rejects.toBe(p2002);
    });

    it('clientRequestId vazio é tratado como ausente', async () => {
      prisma.user.findUnique.mockResolvedValue({ credits: 5 });
      enqueueMock.mockResolvedValue('added');

      await service.create(
        USER_A,
        { originalImagePath: originalImage.path, clientRequestId: '' },
        originalImage,
      );

      expect(prisma.render.findFirst).not.toHaveBeenCalled();
      expect(prisma.render.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ clientRequestId: null }) as unknown,
      });
    });
  });

  describe('remove', () => {
    it('DELETE é condicional a status != PROCESSING e remove o job da fila', async () => {
      prisma.render.deleteMany.mockResolvedValue({ count: 1 });
      removeJobMock.mockResolvedValue('removed');

      await expect(service.remove(USER_A, RENDER_ID)).resolves.toBe('deleted');

      expect(prisma.render.deleteMany).toHaveBeenCalledWith({
        where: {
          id: RENDER_ID,
          userId: USER_A,
          status: { not: RenderStatus.PROCESSING },
        },
      });
      expect(removeJobMock).toHaveBeenCalledWith(RENDER_ID);
    });

    it('PROCESSING: não remove nem mexe na fila', async () => {
      prisma.render.deleteMany.mockResolvedValue({ count: 0 });
      prisma.render.findFirst.mockResolvedValue({
        status: RenderStatus.PROCESSING,
      });

      await expect(service.remove(USER_A, RENDER_ID)).resolves.toBe(
        'processing',
      );
      expect(removeJobMock).not.toHaveBeenCalled();
    });

    it('inexistente/de outro usuário: not-found', async () => {
      prisma.render.deleteMany.mockResolvedValue({ count: 0 });
      prisma.render.findFirst.mockResolvedValue(null);

      await expect(service.remove(USER_A, RENDER_ID)).resolves.toBe(
        'not-found',
      );
    });

    it('status mudou entre DELETE e leitura (PROCESSING -> DONE): tenta de novo', async () => {
      prisma.render.deleteMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });
      prisma.render.findFirst.mockResolvedValue({ status: RenderStatus.DONE });
      removeJobMock.mockResolvedValue('absent');

      await expect(service.remove(USER_A, RENDER_ID)).resolves.toBe('deleted');
      expect(prisma.render.deleteMany).toHaveBeenCalledTimes(2);
    });

    it('falha do Redis ao remover o job não falha a exclusão (worker vê not-found)', async () => {
      prisma.render.deleteMany.mockResolvedValue({ count: 1 });
      removeJobMock.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.remove(USER_A, RENDER_ID)).resolves.toBe('deleted');
    });
  });

  describe('editRender', () => {
    const parent = {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      userId: USER_A,
      status: RenderStatus.DONE,
      prompt: null,
      presetId: 'daylight_9am',
      generatedImageUrl: 'http://x/uploads/renders/a.png',
      generatedImagePath: 'uploads/renders/a.png',
      outputImageMimeType: 'image/png',
    };

    it('enfileira a edição (antes dependia do frontend chamar /process)', async () => {
      prisma.render.findFirst.mockResolvedValue(parent);
      prisma.user.findUnique.mockResolvedValue({ credits: 1 });
      enqueueMock.mockResolvedValue('added');

      await service.editRender(USER_A, parent.id, {});

      expect(enqueueMock).toHaveBeenCalledTimes(1);
      expect(enqueueMock).toHaveBeenCalledWith({
        renderId: RENDER_ID,
        userId: USER_A,
      });
    });

    it('sem créditos: 400 e nada é criado', async () => {
      prisma.render.findFirst.mockResolvedValue(parent);
      prisma.user.findUnique.mockResolvedValue({ credits: 0 });

      await expect(
        service.editRender(USER_A, parent.id, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.render.create).not.toHaveBeenCalled();
      expect(enqueueMock).not.toHaveBeenCalled();
    });
  });

  describe('requeuePendings', () => {
    it('conta já enfileirados sem criar evento duplicado', async () => {
      const createdAt = new Date('2026-01-01T00:00:00Z');
      prisma.render.findMany.mockResolvedValue([
        { id: 'r1', userId: USER_A, createdAt },
        { id: 'r2', userId: USER_A, createdAt },
        { id: 'r3', userId: USER_A, createdAt },
      ]);
      enqueueMock
        .mockResolvedValueOnce('already-queued')
        .mockResolvedValueOnce('re-added')
        .mockRejectedValueOnce(new Error('redis down'));

      const result = await service.requeuePendings(2, 50);

      expect(result).toEqual({
        cutoffMinutes: 2,
        found: 3,
        enqueued: 1,
        alreadyQueued: 1,
        failed: 1,
      });
      const types = prisma.renderEvent.create.mock.calls.map(
        ([arg]: [{ data: { type: RenderEventType; renderId: string } }]) => [
          arg.data.renderId,
          arg.data.type,
        ],
      );
      expect(types).toEqual([
        ['r2', RenderEventType.REQUEUED],
        ['r3', RenderEventType.QUEUE_ENQUEUE_FAILED],
      ]);
    });
  });

  describe('claimForProcessing (lógica; concorrência real nos testes de integração)', () => {
    it.each([RenderStatus.DONE, RenderStatus.PROCESSING, RenderStatus.ERROR])(
      'status %s: não debita nem altera',
      async (status) => {
        prisma.render.findFirst.mockResolvedValue({
          id: RENDER_ID,
          userId: USER_A,
          status,
        });

        const result = await service.claimForProcessing(USER_A, RENDER_ID);

        expect(result.outcome).toBe('not-pending');
        expect(prisma.render.updateMany).not.toHaveBeenCalled();
        expect(prisma.user.updateMany).not.toHaveBeenCalled();
        expect(prisma.creditTransaction.create).not.toHaveBeenCalled();
      },
    );

    it('perdeu a corrida no UPDATE condicional: não debita', async () => {
      prisma.render.findFirst.mockResolvedValue({
        id: RENDER_ID,
        userId: USER_A,
        status: RenderStatus.PENDING,
      });
      prisma.render.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.claimForProcessing(USER_A, RENDER_ID);

      expect(result.outcome).toBe('not-pending');
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.creditTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('failProcessing', () => {
    it('não reembolsa se o render não está PROCESSING (DONE/ERROR/repetição)', async () => {
      prisma.render.findFirst.mockResolvedValue({
        id: RENDER_ID,
        userId: USER_A,
        status: RenderStatus.ERROR,
        creditsUsed: 0,
      });

      const result = await service.failProcessing(USER_A, RENDER_ID, {
        message: 'x',
      });

      expect(result).toMatchObject({ failed: false, refundedCredits: 0 });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.creditTransaction.create).not.toHaveBeenCalled();
    });
  });
});
