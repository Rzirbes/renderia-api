// src/queue/queue.module.ts
import { Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';

import { startRendersWorker } from './workers/renders.worker';
import { RendersModule } from '../modules/renders/renders.module';
import { RenderProcessorService } from '../modules/renders/render-processor.service';
import { RendersService } from '../modules/renders/renders.service';
import { getGeminiTimeoutMs } from '../modules/renders/gemini-render.service';
import { rendersQueue } from '../modules/renders/renders.queue';

const DEFAULT_RECOVERY_INTERVAL_MS = 60 * 1000;
const DEFAULT_STALE_PROCESSING_MINUTES = 15;
const PENDING_REQUEUE_CUTOFF_MINUTES = 2;
/** Limite de espera por etapa do shutdown (recuperação, fechar fila). */
const SHUTDOWN_STEP_TIMEOUT_MS = 5000;

/** Resolve `true` se `promise` terminar antes do limite; nunca rejeita. */
async function settlesWithin(
  promise: Promise<unknown>,
  ms: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
    timer.unref();
  });
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

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
  private recoveryInFlight: Promise<void> | null = null;

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

    const run = this.recover();
    this.recoveryInFlight = run;
    try {
      await run;
    } finally {
      this.recovering = false;
      this.recoveryInFlight = null;
    }
  }

  private async recover(): Promise<void> {
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
    }
  }

  /**
   * Encerramento ordenado (só roda em `app.close()`/shutdown hooks):
   * 1. para o timer de recuperação (nenhum ciclo novo começa);
   * 2. `worker.close()` espera os jobs ATIVOS terminarem — nada em
   *    processamento é interrompido;
   * 3. espera (com limite) um ciclo de recuperação em andamento, que ainda
   *    pode reenfileirar PENDING;
   * 4. fecha a conexão Redis da fila de enfileiramento. Sem isso o processo
   *    não encerra (Jest no CI ficava pendurado). Se o Redis não responder,
   *    força `disconnect()` após o limite. Nunca lança: o restante do
   *    shutdown do Nest continua.
   *
   * Um enqueue que chegue depois do passo 4 falha de forma segura: o render
   * fica PENDING com evento QUEUE_ENQUEUE_FAILED e é recuperado depois.
   */
  async onModuleDestroy() {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.recoveryTimer = null;

    await Promise.all(this.workers.map((w) => w.close()));

    if (
      this.recoveryInFlight &&
      !(await settlesWithin(this.recoveryInFlight, SHUTDOWN_STEP_TIMEOUT_MS))
    ) {
      this.logger.warn('Shutdown: render recovery still running; continuing');
    }

    await this.closeRendersQueue();
  }

  private async closeRendersQueue(): Promise<void> {
    // Promise.resolve().then: captura também exceção síncrona.
    const close = Promise.resolve().then(() => rendersQueue.close());
    if (await settlesWithin(close, SHUTDOWN_STEP_TIMEOUT_MS)) {
      try {
        await close;
        return;
      } catch (err) {
        this.logger.warn(
          `Shutdown: renders queue close failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      this.logger.warn('Shutdown: renders queue close timed out');
    }

    try {
      await rendersQueue.disconnect();
    } catch {
      // conexão já encerrada
    }
  }
}
