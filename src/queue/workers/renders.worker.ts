// src/queue/workers/renders.worker.ts
import { Logger } from '@nestjs/common';
import { Worker } from 'bullmq';

import { bullConnection } from '../connection';
import { RenderProcessorService } from '../../modules/renders/render-processor.service';

const logger = new Logger('RendersWorker');

export function startRendersWorker(
  renderProcessorService: RenderProcessorService,
) {
  return new Worker(
    'renders',
    async (job) => {
      const { renderId, userId } = job.data as {
        renderId: string;
        userId: string;
      };

      logger.log(`Processing render ${renderId}`);

      await renderProcessorService.processRender(userId, renderId);
    },
    { connection: bullConnection },
  );
}
