// src/queue/workers/renders.worker.ts
import { Logger } from '@nestjs/common';
import { Job, Worker } from 'bullmq';

import { bullConnection } from '../connection';
import { RenderProcessorService } from '../../modules/renders/render-processor.service';
import {
  RENDERS_QUEUE_NAME,
  RenderJobData,
} from '../../modules/renders/renders.queue';

const logger = new Logger('RendersWorker');

export function createRendersJobHandler(
  renderProcessorService: RenderProcessorService,
) {
  return async (job: Job<RenderJobData>) => {
    const { renderId, userId } = job.data;

    logger.log(
      `Processing render ${renderId} (attempt ${job.attemptsMade + 1})`,
    );

    // A idempotência vem do claim no banco; ver RenderProcessorService.
    const outcome = await renderProcessorService.processRender(
      userId,
      renderId,
    );

    logger.log(`Render ${renderId} job finished: ${outcome}`);
    return outcome;
  };
}

export function startRendersWorker(
  renderProcessorService: RenderProcessorService,
) {
  const worker = new Worker<RenderJobData>(
    RENDERS_QUEUE_NAME,
    createRendersJobHandler(renderProcessorService),
    { connection: bullConnection },
  );

  worker.on('failed', (job, err) => {
    logger.error(`Job failed: ${job?.id} - ${err.message}`);
  });

  return worker;
}
