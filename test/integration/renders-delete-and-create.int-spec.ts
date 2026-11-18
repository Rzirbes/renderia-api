/**
 * Integração (PostgreSQL REAL e DESCARTÁVEL) da Etapa 2.1:
 * - exclusão de renders não pode atravessar o processamento (PROCESSING) e
 *   deve ser consistente com o claim PENDING -> PROCESSING;
 * - idempotência da criação por (userId, clientRequestId) via índice UNIQUE.
 *
 * Mesmas travas de segurança de renders-idempotency.int-spec.ts: só roda com
 * RENDERS_IT_DATABASE_URL apontando para um banco local com nome descartável.
 * Fila, Gemini e storage são mocks: nenhuma chamada externa.
 */
jest.mock('../../src/modules/renders/renders.queue', () => ({
  rendersQueue: { add: jest.fn() },
  enqueueRenderJob: jest.fn().mockResolvedValue('added'),
  removeRenderJob: jest.fn().mockResolvedValue('removed'),
}));

import { ConflictException } from '@nestjs/common';
import { CreditTxType, PrismaClient, RenderStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { RendersService } from '../../src/modules/renders/renders.service';
import { RenderProcessorService } from '../../src/modules/renders/render-processor.service';
import { GeminiRenderService } from '../../src/modules/renders/gemini-render.service';
import { StorageService } from '../../src/modules/renders/storage.service';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import {
  enqueueRenderJob,
  removeRenderJob,
} from '../../src/modules/renders/renders.queue';

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

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('it-png'),
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const enqueueMock = enqueueRenderJob as jest.MockedFunction<
  typeof enqueueRenderJob
>;
const removeJobMock = removeRenderJob as jest.MockedFunction<
  typeof removeRenderJob
>;

describeIt(
  'Renders — exclusão segura e criação idempotente (PostgreSQL real)',
  () => {
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
      enqueueMock.mockResolvedValue('added');
      removeJobMock.mockResolvedValue('removed');
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
        await sleep(30);
        return {
          ok: true,
          imageBase64: PNG.toString('base64'),
          mimeType: 'image/png',
          presetId: 'daylight_9am',
          text: null,
        };
      });
    });

    async function seedUser(credits: number) {
      return prisma.user.create({
        data: {
          email: `it-${Date.now()}-${Math.random()}@test.local`,
          password: 'x',
          credits,
        },
      });
    }

    async function seedRender(
      userId: string,
      status: RenderStatus = RenderStatus.PENDING,
      extra: { creditsUsed?: number; parentRenderId?: string } = {},
    ) {
      return prisma.render.create({
        data: {
          userId,
          originalImageUrl: 'http://it/x.png',
          originalImagePath: `uploads/originals/${userId}/x.png`,
          presetId: 'daylight_9am',
          status,
          creditsUsed: extra.creditsUsed ?? 0,
          startedAt: status === RenderStatus.PROCESSING ? new Date() : null,
          parentRenderId: extra.parentRenderId,
          events: { create: { type: 'CREATED', toStatus: status } },
        },
      });
    }

    async function ledger(userId: string) {
      const [user, txs] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: userId } }),
        prisma.creditTransaction.findMany({ where: { userId } }),
      ]);
      return {
        credits: user.credits,
        usage: txs.filter((t) => t.type === CreditTxType.USAGE).length,
        refunds: txs.filter((t) => t.type === CreditTxType.REFUND).length,
      };
    }

    // ---------------------------------------------------------------- DELETE

    describe('remove', () => {
      it('PROCESSING: 409 (processing), render e débito preservados; worker conclui normalmente', async () => {
        const user = await seedUser(5);
        const render = await seedRender(user.id);
        await renders.claimForProcessing(user.id, render.id);

        await expect(renders.remove(user.id, render.id)).resolves.toBe(
          'processing',
        );
        expect(removeJobMock).not.toHaveBeenCalled();

        const kept = await prisma.render.findUniqueOrThrow({
          where: { id: render.id },
        });
        expect(kept.status).toBe(RenderStatus.PROCESSING);
        expect(await ledger(user.id)).toEqual({
          credits: 4,
          usage: 1,
          refunds: 0,
        });

        const done = await renders.markAsDone(user.id, render.id, {
          generatedImageUrl: 'u',
          generatedImagePath: 'p',
          outputImageMimeType: 'image/png',
        });
        expect(done.completed).toBe(true);
      });

      it('exclusões repetidas durante o processamento real: todas 409 e o render termina DONE com 1 débito', async () => {
        const user = await seedUser(5);
        const render = await seedRender(user.id);
        gemini.generateFromImage.mockImplementation(async () => {
          await sleep(300);
          return {
            ok: true,
            imageBase64: PNG.toString('base64'),
            mimeType: 'image/png',
            text: null,
          };
        });

        const processing = processor.processRender(user.id, render.id);
        // espera o claim acontecer
        for (let i = 0; i < 50; i++) {
          const r = await prisma.render.findUniqueOrThrow({
            where: { id: render.id },
          });
          if (r.status === RenderStatus.PROCESSING) break;
          await sleep(10);
        }

        const deletes = await Promise.all(
          Array.from({ length: 5 }, () => renders.remove(user.id, render.id)),
        );
        expect(deletes).toEqual(Array(5).fill('processing'));

        await expect(processing).resolves.toBe('done');
        const final = await prisma.render.findUniqueOrThrow({
          where: { id: render.id },
        });
        expect(final.status).toBe(RenderStatus.DONE);
        expect(storage.deleteGeneratedImage).not.toHaveBeenCalled();
        expect(await ledger(user.id)).toEqual({
          credits: 4,
          usage: 1,
          refunds: 0,
        });
      });

      it('PENDING: corrida DELETE x claims (20 rodadas) — banco sempre consistente com cobrança', async () => {
        const user = await seedUser(100);
        let deletedRounds = 0;
        let claimedRounds = 0;

        for (let round = 0; round < 20; round++) {
          const render = await seedRender(user.id);
          const before = await ledger(user.id);

          const [del, ...claims] = await Promise.all([
            renders.remove(user.id, render.id),
            ...Array.from({ length: 3 }, () =>
              renders.claimForProcessing(user.id, render.id),
            ),
          ]);

          const winners = claims.filter((c) => c.outcome === 'claimed');
          const exists = await prisma.render.findUnique({
            where: { id: render.id },
          });
          const after = await ledger(user.id);

          if (del === 'deleted') {
            deletedRounds++;
            expect(exists).toBeNull();
            expect(winners).toHaveLength(0);
            expect(after).toEqual(before); // nada cobrado
            expect(
              await prisma.renderEvent.count({
                where: { renderId: render.id },
              }),
            ).toBe(0);
          } else {
            claimedRounds++;
            expect(del).toBe('processing');
            expect(winners).toHaveLength(1);
            expect(exists?.status).toBe(RenderStatus.PROCESSING);
            expect(after.credits).toBe(before.credits - 1);
            expect(after.usage).toBe(before.usage + 1);
          }
        }

        expect(deletedRounds + claimedRounds).toBe(20);
      });

      it('PENDING removido: job removido da fila; execução tardia do worker não cobra nem chama o Gemini', async () => {
        const user = await seedUser(5);
        const render = await seedRender(user.id);

        await expect(renders.remove(user.id, render.id)).resolves.toBe(
          'deleted',
        );
        expect(removeJobMock).toHaveBeenCalledWith(render.id);

        // Job que já estava ativo (não removível) chega ao claim depois.
        await expect(processor.processRender(user.id, render.id)).resolves.toBe(
          'not-found',
        );
        expect(gemini.generateFromImage).not.toHaveBeenCalled();
        expect(await ledger(user.id)).toEqual({
          credits: 5,
          usage: 0,
          refunds: 0,
        });
      });

      it('PENDING removido com Redis fora: exclusão ainda é concluída', async () => {
        const user = await seedUser(5);
        const render = await seedRender(user.id);
        removeJobMock.mockRejectedValue(new Error('ECONNREFUSED'));

        await expect(renders.remove(user.id, render.id)).resolves.toBe(
          'deleted',
        );
        expect(
          await prisma.render.findUnique({ where: { id: render.id } }),
        ).toBeNull();
      });

      it('DONE e ERROR podem ser removidos; histórico de créditos é preservado e filhos ficam sem pai', async () => {
        const user = await seedUser(5);
        const parent = await seedRender(user.id);
        await processor.processRender(user.id, parent.id); // DONE, 1 débito
        const child = await seedRender(user.id, RenderStatus.ERROR, {
          parentRenderId: parent.id,
        });

        await expect(renders.remove(user.id, parent.id)).resolves.toBe(
          'deleted',
        );
        const orphan = await prisma.render.findUniqueOrThrow({
          where: { id: child.id },
        });
        expect(orphan.parentRenderId).toBeNull();
        await expect(renders.remove(user.id, child.id)).resolves.toBe(
          'deleted',
        );

        expect(await ledger(user.id)).toEqual({
          credits: 4,
          usage: 1,
          refunds: 0,
        });
      });

      it('exclusões simultâneas do mesmo render: uma remove, as demais 404', async () => {
        const user = await seedUser(5);
        const render = await seedRender(user.id, RenderStatus.DONE);

        const results = await Promise.all(
          Array.from({ length: 5 }, () => renders.remove(user.id, render.id)),
        );

        expect(results.filter((r) => r === 'deleted')).toHaveLength(1);
        expect(results.filter((r) => r === 'not-found')).toHaveLength(4);
      });

      it('render de outro usuário: not-found e não é removido', async () => {
        const owner = await seedUser(5);
        const other = await seedUser(5);
        const render = await seedRender(owner.id, RenderStatus.DONE);

        await expect(renders.remove(other.id, render.id)).resolves.toBe(
          'not-found',
        );
        expect(
          await prisma.render.findUnique({ where: { id: render.id } }),
        ).not.toBeNull();
      });
    });

    // ---------------------------------------------------------- IDEMPOTENCY

    describe('create idempotente por (userId, clientRequestId)', () => {
      const imageFor = (userId: string, name = 'a') => ({
        url: `http://it/uploads/originals/${userId}/${name}.png`,
        path: `uploads/originals/${userId}/${name}.png`,
        mimeType: 'image/png',
      });

      it('índice UNIQUE existe no banco (migration aplicada)', async () => {
        const rows = await prisma.$queryRawUnsafe<{ indexdef: string }[]>(
          `SELECT indexdef FROM pg_indexes WHERE tablename = 'Render' AND indexname = 'Render_userId_clientRequestId_key'`,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].indexdef).toMatch(/UNIQUE/);
      });

      it('10 requisições simultâneas com a mesma chave e payload: 1 render, 1 job, 9 replays', async () => {
        const user = await seedUser(5);
        const img = imageFor(user.id);
        const dto = {
          originalImagePath: img.path,
          clientRequestId: 'req-same',
          prompt: 'p',
        };

        const results = await Promise.all(
          Array.from({ length: 10 }, () => renders.create(user.id, dto, img)),
        );

        const ids = new Set(results.map((r) => r.render.id));
        expect(ids.size).toBe(1);
        expect(results.filter((r) => !r.replayed)).toHaveLength(1);
        expect(results.filter((r) => r.replayed)).toHaveLength(9);

        expect(
          await prisma.render.count({
            where: { userId: user.id, clientRequestId: 'req-same' },
          }),
        ).toBe(1);
        expect(
          await prisma.renderEvent.count({ where: { type: 'CREATED' } }),
        ).toBe(1);

        // Só o vencedor enfileira a partir da criação; replays de PENDING
        // re-garantem o mesmo jobId (no-op no BullMQ).
        for (const call of enqueueMock.mock.calls) {
          expect(call[0].renderId).toBe([...ids][0]);
        }
        // Nenhum débito na criação.
        expect(await ledger(user.id)).toEqual({
          credits: 5,
          usage: 0,
          refunds: 0,
        });
      });

      it('caminho P2002 real: pré-checagem não vê a linha, INSERT viola o UNIQUE e vira replay/409', async () => {
        const user = await seedUser(5);
        const img = imageFor(user.id);
        const dto = {
          originalImagePath: img.path,
          clientRequestId: 'req-race',
        };
        const first = await renders.create(user.id, dto, img);
        enqueueMock.mockClear();

        // Simula a janela da corrida: o findFirst inicial "não vê" a linha.
        const createSpy = jest.fn(
          (a: Parameters<typeof prisma.render.create>[0]) =>
            prisma.render.create(a),
        );
        const blindPrisma = {
          user: prisma.user,
          renderEvent: prisma.renderEvent,
          render: {
            findFirst: jest
              .fn()
              .mockResolvedValueOnce(null)
              .mockImplementation(
                (a: Parameters<typeof prisma.render.findFirst>[0]) =>
                  prisma.render.findFirst(a),
              ),
            create: createSpy,
          },
        };
        const racing = new RendersService(
          blindPrisma as unknown as PrismaService,
        );

        const replay = await racing.create(user.id, dto, img);
        expect(createSpy).toHaveBeenCalledTimes(1); // INSERT tentado e rejeitado
        expect(replay).toMatchObject({
          replayed: true,
          render: { id: first.render.id },
        });

        blindPrisma.render.findFirst.mockResolvedValueOnce(null);
        await expect(
          racing.create(user.id, { ...dto, prompt: 'outro' }, img),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(createSpy).toHaveBeenCalledTimes(2);
        expect(enqueueMock).toHaveBeenCalledTimes(1); // só o replay de PENDING
        expect(await prisma.render.count({ where: { userId: user.id } })).toBe(
          1,
        );
      });

      it('mesma chave, payloads diferentes em paralelo: 1 render; os divergentes recebem 409', async () => {
        const user = await seedUser(5);
        const img = imageFor(user.id);
        const make = (prompt: string) =>
          renders
            .create(
              user.id,
              { originalImagePath: img.path, clientRequestId: 'req-x', prompt },
              img,
            )
            .then(
              (r) => ({ ok: true as const, prompt, r }),
              (e: unknown) => ({ ok: false as const, prompt, e }),
            );

        const results = await Promise.all([
          ...Array.from({ length: 5 }, () => make('A')),
          ...Array.from({ length: 5 }, () => make('B')),
        ]);

        const stored = await prisma.render.findMany({
          where: { userId: user.id, clientRequestId: 'req-x' },
        });
        expect(stored).toHaveLength(1);
        const winnerPrompt = stored[0].prompt;

        for (const res of results) {
          if (res.prompt === winnerPrompt) {
            expect(res.ok).toBe(true);
          } else {
            expect(res.ok).toBe(false);
            if (!res.ok) {
              expect(res.e).toBeInstanceOf(ConflictException);
              expect(
                ((res.e as ConflictException).getResponse() as { code: string })
                  .code,
              ).toBe('IDEMPOTENCY_KEY_REUSED');
            }
          }
        }
      });

      it('mesma chave com imagem ou preset diferente (sequencial): 409, nada criado', async () => {
        const user = await seedUser(5);
        const img = imageFor(user.id);
        await renders.create(
          user.id,
          { originalImagePath: img.path, clientRequestId: 'req-y' },
          img,
        );

        const other = imageFor(user.id, 'b');
        await expect(
          renders.create(
            user.id,
            { originalImagePath: other.path, clientRequestId: 'req-y' },
            other,
          ),
        ).rejects.toBeInstanceOf(ConflictException);
        await expect(
          renders.create(
            user.id,
            {
              originalImagePath: img.path,
              clientRequestId: 'req-y',
              presetId: 'blue_hour',
            },
            img,
          ),
        ).rejects.toBeInstanceOf(ConflictException);

        expect(await prisma.render.count({ where: { userId: user.id } })).toBe(
          1,
        );
      });

      it('a mesma chave em usuários diferentes não conflita', async () => {
        const a = await seedUser(5);
        const b = await seedUser(5);

        const [ra, rb] = await Promise.all([
          renders.create(
            a.id,
            {
              originalImagePath: imageFor(a.id).path,
              clientRequestId: 'shared',
            },
            imageFor(a.id),
          ),
          renders.create(
            b.id,
            {
              originalImagePath: imageFor(b.id).path,
              clientRequestId: 'shared',
            },
            imageFor(b.id),
          ),
        ]);

        expect(ra.replayed || rb.replayed).toBe(false);
        expect(ra.render.id).not.toBe(rb.render.id);
      });

      it('sem clientRequestId: requisições iguais criam renders distintos (NULL não conflita)', async () => {
        const user = await seedUser(5);
        const img = imageFor(user.id);

        const results = await Promise.all(
          Array.from({ length: 3 }, () =>
            renders.create(user.id, { originalImagePath: img.path }, img),
          ),
        );

        expect(new Set(results.map((r) => r.render.id)).size).toBe(3);
        expect(results.every((r) => !r.replayed)).toBe(true);
      });

      it('replay depois do processamento devolve o render DONE sem novo job nem débito', async () => {
        const user = await seedUser(5);
        const img = imageFor(user.id);
        const dto = {
          originalImagePath: img.path,
          clientRequestId: 'req-done',
        };

        const first = await renders.create(user.id, dto, img);
        await processor.processRender(user.id, first.render.id);
        enqueueMock.mockClear();

        const again = await renders.create(user.id, dto, img);

        expect(again.replayed).toBe(true);
        expect(again.render.id).toBe(first.render.id);
        expect(again.render.status).toBe(RenderStatus.DONE);
        expect(enqueueMock).not.toHaveBeenCalled();
        expect(await ledger(user.id)).toEqual({
          credits: 4,
          usage: 1,
          refunds: 0,
        });
      });

      it('chave liberada após excluir o render pode ser reutilizada', async () => {
        const user = await seedUser(5);
        const img = imageFor(user.id);
        const dto = { originalImagePath: img.path, clientRequestId: 'req-del' };

        const first = await renders.create(user.id, dto, img);
        await renders.remove(user.id, first.render.id);
        const second = await renders.create(user.id, dto, img);

        expect(second.replayed).toBe(false);
        expect(second.render.id).not.toBe(first.render.id);
      });
    });
  },
);
