// src/queue/workers/renders.worker.ts
import { Logger } from '@nestjs/common';
import { Worker } from 'bullmq';

import { bullConnection } from '../connection';
import { RendersService } from '../../modules/renders/renders.service';

const logger = new Logger('RendersWorker');

export function startRendersWorker(rendersService: RendersService) {
  return new Worker(
    'renders',
    async (job) => {
      const { renderId, userId } = job.data as {
        renderId: string;
        userId: string;
      };

      logger.log(`Processing render ${renderId}`);

      await rendersService.process(userId, renderId);

      // TODO: provider real aqui no futuro
      await rendersService.complete(userId, renderId);
    },
    { connection: bullConnection },
  );
}
