const workerInstances: Array<{ queue: string; close: jest.Mock }> = [];

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn() })),
  Worker: jest.fn().mockImplementation((queue: string) => {
    const w = { queue, close: jest.fn(), on: jest.fn() };
    workerInstances.push(w);
    return w;
  }),
}));

import { Job, Worker } from 'bullmq';
import { QueueModule } from '../queue.module';
import { createRendersJobHandler } from '../workers/renders.worker';
import { RenderProcessorService } from '../../modules/renders/render-processor.service';
import { RendersService } from '../../modules/renders/renders.service';
import { RenderJobData } from '../../modules/renders/renders.queue';

describe('Renders worker', () => {
  const processor = { processRender: jest.fn() };
  const rendersService = {
    recoverStaleProcessing: jest.fn(),
    requeuePendings: jest.fn(),
  };
  const originalEnv = { ...process.env };

  const makeModule = () =>
    new QueueModule(
      processor as unknown as RenderProcessorService,
      rendersService as unknown as RendersService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    workerInstances.length = 0;
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('inicia exatamente UM consumidor da fila renders', async () => {
    const mod = makeModule();
    mod.onModuleInit();

    expect(Worker).toHaveBeenCalledTimes(1);
    expect(workerInstances.map((w) => w.queue)).toEqual(['renders']);

    await mod.onModuleDestroy();
    expect(workerInstances[0].close).toHaveBeenCalled();
  });

  it('RENDERS_WORKER_ENABLED=false não consome a fila', () => {
    process.env.RENDERS_WORKER_ENABLED = 'false';
    makeModule().onModuleInit();
    expect(Worker).not.toHaveBeenCalled();
  });

  it('o job delega ao processador idempotente e devolve o resultado', async () => {
    processor.processRender.mockResolvedValue('not-pending');
    const handler = createRendersJobHandler(
      processor as unknown as RenderProcessorService,
    );

    const result = await handler({
      data: { renderId: 'r1', userId: 'u1' },
      attemptsMade: 1,
    } as Job<RenderJobData>);

    expect(processor.processRender).toHaveBeenCalledWith('u1', 'r1');
    expect(result).toBe('not-pending');
  });

  it('retry do BullMQ: erro antes do claim é propagado para o BullMQ tentar de novo', async () => {
    processor.processRender.mockRejectedValue(new Error('db down'));
    const handler = createRendersJobHandler(
      processor as unknown as RenderProcessorService,
    );

    await expect(
      handler({
        data: { renderId: 'r1', userId: 'u1' },
        attemptsMade: 0,
      } as Job<RenderJobData>),
    ).rejects.toThrow('db down');
  });

  describe('recuperação periódica', () => {
    it('stale >= timeout do Gemini + margem e reenfileira PENDING', async () => {
      process.env.GEMINI_TIMEOUT_MS = String(20 * 60 * 1000);
      process.env.RENDER_PROCESSING_STALE_MINUTES = '5';
      rendersService.recoverStaleProcessing.mockResolvedValue({});
      rendersService.requeuePendings.mockResolvedValue({});

      await makeModule().runRecovery();

      // Configuração menor que o timeout do Gemini é elevada automaticamente.
      expect(rendersService.recoverStaleProcessing).toHaveBeenCalledWith(21);
      expect(rendersService.requeuePendings).toHaveBeenCalledWith(2);
    });

    it('não propaga erro (não derruba o processo) e não roda em paralelo', async () => {
      let release!: () => void;
      rendersService.recoverStaleProcessing.mockImplementation(
        () => new Promise<void>((r) => (release = r)),
      );
      rendersService.requeuePendings.mockRejectedValue(new Error('x'));

      const mod = makeModule();
      const first = mod.runRecovery();
      await mod.runRecovery(); // ignorada: já em execução
      release();
      await expect(first).resolves.toBeUndefined();

      expect(rendersService.recoverStaleProcessing).toHaveBeenCalledTimes(1);
    });
  });
});
