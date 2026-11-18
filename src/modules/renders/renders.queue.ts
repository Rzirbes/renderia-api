import { JobsOptions, Queue } from 'bullmq';
import { bullConnection } from '../../queue/connection';

export const RENDERS_QUEUE_NAME = 'renders';
export const RENDER_JOB_NAME = 'render-job';

export type RenderJobData = { renderId: string; userId: string };

export const rendersQueue = new Queue(RENDERS_QUEUE_NAME, {
  connection: bullConnection,
});

/**
 * `jobId = renderId` faz o BullMQ deduplicar: adicionar de novo um job com o
 * mesmo id enquanto ele existe na fila é um no-op. Os retries do BullMQ só
 * têm efeito para falhas ANTES do claim no banco (ver RenderProcessorService);
 * depois do claim o processador nunca relança erro.
 */
export function renderJobOptions(renderId: string): JobsOptions {
  return {
    jobId: renderId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  };
}

export type EnqueueRenderResult = 'added' | 'already-queued' | 're-added';

/**
 * Enfileira o render de forma idempotente.
 *
 * - Sem job com esse id: adiciona.
 * - Job ativo/esperando/atrasado: não faz nada.
 * - Job terminal (completed/failed) para um render que o chamador sabe estar
 *   PENDING (ex.: falha de infraestrutura antes do claim): remove e re-adiciona.
 *   É seguro porque a execução é protegida pelo claim condicional no banco
 *   (PENDING -> PROCESSING), não pela fila.
 */
export async function enqueueRenderJob(
  data: RenderJobData,
): Promise<EnqueueRenderResult> {
  const existing = await rendersQueue.getJob(data.renderId);

  if (existing) {
    const state = await existing.getState();
    if (state !== 'completed' && state !== 'failed') {
      return 'already-queued';
    }

    await existing.remove();
    await rendersQueue.add(
      RENDER_JOB_NAME,
      data,
      renderJobOptions(data.renderId),
    );
    return 're-added';
  }

  await rendersQueue.add(
    RENDER_JOB_NAME,
    data,
    renderJobOptions(data.renderId),
  );
  return 'added';
}
