// src/queue/queue.module.ts
import { Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';

import { RendersService } from '../modules/renders/renders.service';
import { startRendersWorker } from './workers/renders.worker';
import { RendersModule } from 'src/modules/renders/renders.module';

@Module({
  providers: [],
  exports: [],
  imports: [RendersModule],
})
export class QueueModule implements OnModuleInit, OnModuleDestroy {
  private workers: Worker[] = [];

  constructor(private readonly rendersService: RendersService) {}

  onModuleInit() {
    const rendersWorker = startRendersWorker(this.rendersService);
    this.workers.push(rendersWorker);
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((w) => w.close()));
  }
}
