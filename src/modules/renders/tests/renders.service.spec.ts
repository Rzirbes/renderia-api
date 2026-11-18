jest.mock('../renders.queue', () => ({
  rendersQueue: { add: jest.fn() },
  enqueueRenderJob: jest.fn(),
}));

import { BadRequestException } from '@nestjs/common';
import { RenderEventType, RenderStatus } from '@prisma/client';

import { RendersService } from '../renders.service';
import { enqueueRenderJob } from '../renders.queue';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { RENDER_ID, USER_A } from './sandbox.helper-spec';

const enqueueMock = enqueueRenderJob as jest.MockedFunction<
  typeof enqueueRenderJob
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

      const render = await service.create(
        USER_A,
        { originalImagePath: originalImage.path },
        originalImage,
      );

      expect(render.id).toBe(RENDER_ID);
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

      const render = await service.create(
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

    it('clientRequestId repetido devolve o render existente sem novo job', async () => {
      const existing = { id: RENDER_ID, userId: USER_A };
      prisma.render.findFirst.mockResolvedValue(existing);

      const render = await service.create(
        USER_A,
        { originalImagePath: originalImage.path, clientRequestId: 'req-1' },
        originalImage,
      );

      expect(render).toBe(existing);
      expect(prisma.render.create).not.toHaveBeenCalled();
      expect(enqueueMock).not.toHaveBeenCalled();
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
