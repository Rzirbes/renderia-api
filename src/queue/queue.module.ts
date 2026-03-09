// src/queue/queue.module.ts
import { Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';

import { startRendersWorker } from './workers/renders.worker';
import { RendersModule } from 'src/modules/renders/renders.module';
import { RenderProcessorService } from 'src/modules/renders/render-processor.service';

@Module({
  providers: [],
  exports: [],
  imports: [RendersModule],
})
export class QueueModule implements OnModuleInit, OnModuleDestroy {
  private workers: Worker[] = [];

  constructor(
    private readonly renderProcessorService: RenderProcessorService,
  ) {}

  onModuleInit() {
    const rendersWorker = startRendersWorker(this.renderProcessorService);
    this.workers.push(rendersWorker);
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((w) => w.close()));
  }
}
