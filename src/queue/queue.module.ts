// src/queue/queue.module.ts
import { Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';

import { startRendersWorker } from './workers/renders.worker';
import { RendersModule } from '../modules/renders/renders.module';
import { RenderProcessorService } from '../modules/renders/render-processor.service';
import { RendersService } from '../modules/renders/renders.service';
import { getGeminiTimeoutMs } from '../modules/renders/gemini-render.service';

const DEFAULT_RECOVERY_INTERVAL_MS = 60 * 1000;
const DEFAULT_STALE_PROCESSING_MINUTES = 15;
const PENDING_REQUEUE_CUTOFF_MINUTES = 2;

function positiveNumberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Único consumidor da fila `renders` neste processo.
 *
 * - `RENDERS_WORKER_ENABLED=false` desliga worker e recuperação (útil para
 *   rodar a API sem consumir a fila, ex.: testes e2e).
 * - A recuperação periódica reenfileira PENDING esquecidos e encerra (com
 *   reembolso) PROCESSING travados. Ambas são idempotentes e seguras com
 *   várias instâncias, pois dependem de transições condicionais no banco.
 */
@Module({
  providers: [],
  exports: [],
  imports: [RendersModule],
})
export class QueueModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueModule.name);
  private workers: Worker[] = [];
  private recoveryTimer: NodeJS.Timeout | null = null;
  private recovering = false;

  constructor(
    private readonly renderProcessorService: RenderProcessorService,
    private readonly rendersService: RendersService,
  ) {}

  onModuleInit() {
    if (process.env.RENDERS_WORKER_ENABLED === 'false') {
      this.logger.warn(
        'Renders worker disabled (RENDERS_WORKER_ENABLED=false)',
      );
      return;
    }

    const rendersWorker = startRendersWorker(this.renderProcessorService);
    this.workers.push(rendersWorker);

    const intervalMs = positiveNumberFromEnv(
      'RENDER_RECOVERY_INTERVAL_MS',
      DEFAULT_RECOVERY_INTERVAL_MS,
    );
    this.recoveryTimer = setInterval(() => {
      void this.runRecovery();
    }, intervalMs);
    this.recoveryTimer.unref();
  }

  /** Exposto para testes. */
  async runRecovery(): Promise<void> {
    if (this.recovering) return;
    this.recovering = true;

    try {
      const staleMinutes = Math.max(
        positiveNumberFromEnv(
          'RENDER_PROCESSING_STALE_MINUTES',
          DEFAULT_STALE_PROCESSING_MINUTES,
        ),
        // Nunca menor que o timeout do Gemini + 1 minuto de margem.
        Math.ceil(getGeminiTimeoutMs() / 60000) + 1,
      );

      await this.rendersService.recoverStaleProcessing(staleMinutes);
      await this.rendersService.requeuePendings(PENDING_REQUEUE_CUTOFF_MINUTES);
    } catch (err) {
      this.logger.warn(
        `Render recovery failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.recovering = false;
    }
  }

  async onModuleDestroy() {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    await Promise.all(this.workers.map((w) => w.close()));
  }
}
