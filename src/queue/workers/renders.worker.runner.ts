// src/queue/workers/renders.worker.runner.ts
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Worker } from 'bullmq';

import { bullConnection } from '../connection';
import { RendersService } from '../../modules/renders/renders.service';

@Injectable()
export class RendersWorkerRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RendersWorkerRunner.name);
  private worker: Worker | null = null;

  constructor(private readonly rendersService: RendersService) {}

  onModuleInit() {
    this.worker = new Worker(
      'renders',
      async (job) => {
        const { renderId, userId } = job.data as {
          renderId: string;
          userId: string;
        };

        this.logger.log(`Processing render ${renderId}`);

        await this.rendersService.process(userId, renderId);

        // TODO: provider real aqui no futuro
        await this.rendersService.complete(userId, renderId);
      },
      { connection: bullConnection },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`Job completed: ${job.id}`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job failed: ${job?.id} - ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
