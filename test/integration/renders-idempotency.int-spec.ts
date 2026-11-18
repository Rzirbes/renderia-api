/**
 * Testes de integração de idempotência/cobrança contra um PostgreSQL REAL e
 * DESCARTÁVEL. Validam o que mocks não conseguem: locks de linha e
 * transações concorrentes.
 *
 * Segurança:
 * - Só roda com RENDERS_IT_DATABASE_URL explícita (nunca lê DATABASE_URL).
 * - Recusa qualquer host que não seja localhost/127.0.0.1 e bancos cujo nome
 *   não contenha "test"/"it" — impede apontar para o Neon por engano.
 * - Fila (Redis/BullMQ), Gemini e storage são mocks: nenhuma chamada externa.
 *
 * Como rodar (ver README/entrega):
 *   docker run -d --rm --name renderia-it-pg -e POSTGRES_PASSWORD=it \
 *     -e POSTGRES_DB=renderia_it -p 127.0.0.1:55432:5432 postgres:16
 *   DATABASE_URL=postgresql://postgres:it@127.0.0.1:55432/renderia_it \
 *     npx prisma migrate deploy
 *   RENDERS_IT_DATABASE_URL=postgresql://postgres:it@127.0.0.1:55432/renderia_it \
 *     npm run test:integration
 */
jest.mock('../../src/modules/renders/renders.queue', () => ({
  rendersQueue: { add: jest.fn() },
  enqueueRenderJob: jest.fn().mockResolvedValue('added'),
}));

import { CreditTxType, PrismaClient, RenderStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { RendersService } from '../../src/modules/renders/renders.service';
import { RenderProcessorService } from '../../src/modules/renders/render-processor.service';
import { GeminiRenderService } from '../../src/modules/renders/gemini-render.service';
import { StorageService } from '../../src/modules/renders/storage.service';
import { PrismaService } from '../../src/database/prisma/prisma.service';

const IT_URL = process.env.RENDERS_IT_DATABASE_URL;

function assertSafeUrl(raw: string) {
  const url = new URL(raw);
  const db = url.pathname.replace(/^\//, '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error(`Integration DB must be local, got host ${url.hostname}`);
  }
  if (!/(test|_it\b|^it_|_it$)/i.test(db)) {
    throw new Error(`Integration DB name must look disposable, got ${db}`);
  }
}

const describeIt = IT_URL ? describe : describe.skip;

// PNG mínimo (assinatura + bytes) — suficiente para detecção por magic bytes.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('it-png'),
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describeIt('Renders — idempotência e cobrança (PostgreSQL real)', () => {
  let pool: Pool;
  let prisma: PrismaClient;
  let renders: RendersService;
  let processor: RenderProcessorService;

  const gemini = { generateFromImage: jest.fn() };
  const storage = {
    readStoredImage: jest.fn(),
    uploadGeneratedImage: jest.fn(),
    deleteGeneratedImage: jest.fn(),
  };

  beforeAll(async () => {
    assertSafeUrl(IT_URL!);
    pool = new Pool({ connectionString: IT_URL, max: 20 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    await prisma.$connect();
    renders = new RendersService(prisma as unknown as PrismaService);
    processor = new RenderProcessorService(
      renders,
      gemini as unknown as GeminiRenderService,
      storage as unknown as StorageService,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await pool?.end().catch(() => undefined);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await prisma.$executeRawUnsafe(
      'TRUNCATE "RenderEvent", "CreditTransaction", "Render", "User" CASCADE',
    );
    storage.readStoredImage.mockResolvedValue({
      buffer: PNG,
      mimeType: 'image/png',
    });
    storage.uploadGeneratedImage.mockImplementation(
      ({ renderId }: { renderId: string }) => ({
        url: `http://it/uploads/renders/${renderId}.png`,
        path: `uploads/renders/${renderId}.png`,
        mimeType: 'image/png',
      }),
    );
    gemini.generateFromImage.mockImplementation(async () => {
      await sleep(50);
      return {
        ok: true,
        imageBase64: PNG.toString('base64'),
        mimeType: 'image/png',
        presetId: 'daylight_9am',
        text: null,
      };
    });
  });

  async function seed(opts: {
    credits: number;
    status?: RenderStatus;
    creditsUsed?: number;
    startedAt?: Date | null;
  }) {
    const user = await prisma.user.create({
      data: {
        email: `it-${Date.now()}-${Math.random()}@test.local`,
        password: 'x',
        credits: opts.credits,
      },
    });
    const render = await prisma.render.create({
      data: {
        userId: user.id,
        originalImageUrl: 'http://it/x.png',
        originalImagePath: `uploads/originals/${user.id}/x.png`,
        presetId: 'daylight_9am',
        status: opts.status ?? RenderStatus.PENDING,
        creditsUsed: opts.creditsUsed ?? 0,
        startedAt: opts.startedAt ?? null,
      },
    });
    return { user, render };
  }

  async function ledger(userId: string) {
    const [user, txs] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      prisma.creditTransaction.findMany({ where: { userId } }),
    ]);
    return {
      credits: user.credits,
      usage: txs.filter((t) => t.type === CreditTxType.USAGE),
      refunds: txs.filter((t) => t.type === CreditTxType.REFUND),
      net: txs.reduce((s, t) => s + t.amount, 0),
    };
  }

  it('10 claims simultâneos do mesmo render: 1 vencedor, 1 débito', async () => {
    const { user, render } = await seed({ credits: 5 });

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        renders.claimForProcessing(user.id, render.id),
      ),
    );

    expect(results.filter((r) => r.outcome === 'claimed')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'not-pending')).toHaveLength(9);

    const l = await ledger(user.id);
    expect(l.credits).toBe(4);
    expect(l.usage).toHaveLength(1);
    expect(l.net).toBe(-1);

    const started = await prisma.renderEvent.count({
      where: { renderId: render.id, type: 'PROCESSING_STARTED' },
    });
    expect(started).toBe(1);
  });

  it('duas execuções simultâneas (worker + retry/ /process legado): Gemini chamado 1 vez', async () => {
    const { user, render } = await seed({ credits: 5 });

    const outcomes = await Promise.all([
      processor.processRender(user.id, render.id),
      processor.processRender(user.id, render.id),
    ]);

    expect(outcomes.sort()).toEqual(['done', 'not-pending']);
    expect(gemini.generateFromImage).toHaveBeenCalledTimes(1);

    const final = await prisma.render.findUniqueOrThrow({
      where: { id: render.id },
    });
    expect(final.status).toBe(RenderStatus.DONE);
    expect(final.creditsUsed).toBe(1);

    const l = await ledger(user.id);
    expect(l.credits).toBe(4);
    expect(l.usage).toHaveLength(1);
    expect(l.refunds).toHaveLength(0);
  });

  it('render DONE: nova execução não chama Gemini nem cobra', async () => {
    const { user, render } = await seed({ credits: 5 });
    await processor.processRender(user.id, render.id);
    gemini.generateFromImage.mockClear();

    await expect(processor.processRender(user.id, render.id)).resolves.toBe(
      'not-pending',
    );

    expect(gemini.generateFromImage).not.toHaveBeenCalled();
    expect((await ledger(user.id)).credits).toBe(4);
  });

  it('render PROCESSING: nova execução não chama Gemini nem cobra', async () => {
    const { user, render } = await seed({
      credits: 5,
      status: RenderStatus.PROCESSING,
      creditsUsed: 1,
      startedAt: new Date(),
    });

    await expect(processor.processRender(user.id, render.id)).resolves.toBe(
      'not-pending',
    );
    expect(gemini.generateFromImage).not.toHaveBeenCalled();
    expect((await ledger(user.id)).credits).toBe(5);
  });

  it('falha do Gemini: ERROR, reembolso único, saldo restaurado; repetição não reembolsa de novo', async () => {
    const { user, render } = await seed({ credits: 5 });
    gemini.generateFromImage.mockRejectedValue(new Error('503 overloaded'));

    await expect(processor.processRender(user.id, render.id)).resolves.toBe(
      'failed',
    );
    // retry do BullMQ / chamada repetida
    await expect(processor.processRender(user.id, render.id)).resolves.toBe(
      'not-pending',
    );

    const final = await prisma.render.findUniqueOrThrow({
      where: { id: render.id },
    });
    expect(final.status).toBe(RenderStatus.ERROR);
    expect(final.errorCode).toBe('GEMINI_ERROR');
    expect(final.creditsUsed).toBe(0);
    expect(gemini.generateFromImage).toHaveBeenCalledTimes(1);

    const l = await ledger(user.id);
    expect(l.credits).toBe(5);
    expect(l.usage).toHaveLength(1);
    expect(l.refunds).toHaveLength(1);
    expect(l.net).toBe(0);
  });

  it('5 failProcessing simultâneos: um único reembolso', async () => {
    const { user, render } = await seed({ credits: 5 });
    await renders.claimForProcessing(user.id, render.id);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        renders.failProcessing(user.id, render.id, { message: 'x' }),
      ),
    );

    expect(results.filter((r) => r.failed)).toHaveLength(1);
    const l = await ledger(user.id);
    expect(l.credits).toBe(5);
    expect(l.refunds).toHaveLength(1);
  });

  it('corrida conclusão x falha: exatamente um vence e o saldo é coerente com o status', async () => {
    for (let i = 0; i < 5; i++) {
      const { user, render } = await seed({ credits: 5 });
      await renders.claimForProcessing(user.id, render.id);

      const [done, fail] = await Promise.all([
        renders.markAsDone(user.id, render.id, {
          generatedImageUrl: 'u',
          generatedImagePath: 'p',
          outputImageMimeType: 'image/png',
        }),
        renders.failProcessing(user.id, render.id, {
          code: 'PROCESSING_TIMEOUT',
          message: 'x',
        }),
      ]);

      expect(Number(done.completed) + Number(fail.failed)).toBe(1);

      const final = await prisma.render.findUniqueOrThrow({
        where: { id: render.id },
      });
      const l = await ledger(user.id);
      if (final.status === RenderStatus.DONE) {
        expect(l.credits).toBe(4);
        expect(l.refunds).toHaveLength(0);
      } else {
        expect(final.status).toBe(RenderStatus.ERROR);
        expect(l.credits).toBe(5);
        expect(l.refunds).toHaveLength(1);
      }
    }
  });

  it('retomada após queda do worker: PROCESSING travado vira ERROR com reembolso único; resposta tardia é descartada', async () => {
    const { user, render } = await seed({ credits: 5 });
    await renders.claimForProcessing(user.id, render.id);
    await prisma.render.update({
      where: { id: render.id },
      data: { startedAt: new Date(Date.now() - 30 * 60 * 1000) },
    });

    const [a, b] = await Promise.all([
      renders.recoverStaleProcessing(15),
      renders.recoverStaleProcessing(15),
    ]);
    expect(a.recovered + b.recovered).toBe(1);

    const final = await prisma.render.findUniqueOrThrow({
      where: { id: render.id },
    });
    expect(final.status).toBe(RenderStatus.ERROR);
    expect(final.errorCode).toBe('PROCESSING_TIMEOUT');

    // Gemini "volta" depois da recuperação: não pode concluir.
    const late = await renders.markAsDone(user.id, render.id, {
      generatedImageUrl: 'u',
      generatedImagePath: 'p',
      outputImageMimeType: 'image/png',
    });
    expect(late.completed).toBe(false);

    const l = await ledger(user.id);
    expect(l.credits).toBe(5);
    expect(l.refunds).toHaveLength(1);
  });

  it('PROCESSING recente não é recuperado (worker pode estar vivo)', async () => {
    const { user, render } = await seed({ credits: 5 });
    await renders.claimForProcessing(user.id, render.id);

    const res = await renders.recoverStaleProcessing(15);

    expect(res.recovered).toBe(0);
    const final = await prisma.render.findUniqueOrThrow({
      where: { id: render.id },
    });
    expect(final.status).toBe(RenderStatus.PROCESSING);
  });

  it('sem saldo no claim: ERROR terminal, sem débito e sem Gemini', async () => {
    const { user, render } = await seed({ credits: 0 });

    await expect(processor.processRender(user.id, render.id)).resolves.toBe(
      'insufficient-credits',
    );

    expect(gemini.generateFromImage).not.toHaveBeenCalled();
    const final = await prisma.render.findUniqueOrThrow({
      where: { id: render.id },
    });
    expect(final.status).toBe(RenderStatus.ERROR);
    expect(final.errorCode).toBe('INSUFFICIENT_CREDITS');
    const l = await ledger(user.id);
    expect(l.credits).toBe(0);
    expect(l.usage).toHaveLength(0);
  });

  it('saldo 1 e dois renders diferentes em paralelo: só um é processado, saldo nunca negativo', async () => {
    const { user, render: r1 } = await seed({ credits: 1 });
    const r2 = await prisma.render.create({
      data: {
        userId: user.id,
        originalImageUrl: 'http://it/y.png',
        originalImagePath: `uploads/originals/${user.id}/y.png`,
        presetId: 'daylight_9am',
      },
    });

    const outcomes = await Promise.all([
      processor.processRender(user.id, r1.id),
      processor.processRender(user.id, r2.id),
    ]);

    expect(outcomes.sort()).toEqual(['done', 'insufficient-credits']);
    expect(gemini.generateFromImage).toHaveBeenCalledTimes(1);
    const l = await ledger(user.id);
    expect(l.credits).toBe(0);
    expect(l.usage).toHaveLength(1);
  });
});
