jest.mock('../renders.queue', () => ({
  rendersQueue: { add: jest.fn() },
  enqueueRenderJob: jest.fn(),
}));

import request from 'supertest';
import { Server } from 'http';
import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Request } from 'express';
import { RenderStatus } from '@prisma/client';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { RendersController } from '../renders.controller';
import { RendersService } from '../renders.service';
import { RenderProcessorService } from '../render-processor.service';
import { StorageService } from '../storage.service';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import {
  FILE_ID,
  PNG_BYTES,
  RENDER_ID,
  TEXT_BYTES,
  USER_A,
  USER_B,
  createSandbox,
} from './sandbox.helper-spec';

class FakeJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: { userId: string; email: string } }>();
    req.user = { userId: USER_A, email: 'a@test.com' };
    return true;
  }
}

const now = new Date('2026-01-01T00:00:00.000Z');

describe('RendersController (HTTP) — imagem original controlada pelo servidor', () => {
  let app: INestApplication;
  let server: Server;
  let sandbox: Awaited<ReturnType<typeof createSandbox>>;

  const rendersService = {
    create: jest.fn(),
    findById: jest.fn(),
    enqueue: jest.fn(),
    remove: jest.fn(),
  };
  const renderProcessor = { processRender: jest.fn() };
  const ownPath = `uploads/originals/${USER_A}/${FILE_ID}.png`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RendersController],
      providers: [
        StorageService,
        { provide: RendersService, useValue: rendersService },
        { provide: RenderProcessorService, useValue: renderProcessor },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeJwtGuard)
      .compile();

    app = moduleRef.createNestApplication();
    // Mesma configuração de src/main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    // listen(0) em vez de init(): várias requisições simultâneas no mesmo
    // servidor (o supertest abre um listen por requisição se não houver).
    await app.listen(0);
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    sandbox = await createSandbox();
    jest.clearAllMocks();
    process.env.APP_URL = 'https://api.example.test';
    await writeFile(join(sandbox.root, ownPath), PNG_BYTES);
    rendersService.create.mockImplementation(
      (userId: string, _dto: unknown, img: { url: string }) => ({
        replayed: false,
        render: {
          id: RENDER_ID,
          userId,
          originalImageUrl: img.url,
          generatedImageUrl: null,
          prompt: null,
          status: RenderStatus.PENDING,
          creditsUsed: 0,
          traceId: null,
          clientRequestId: null,
          providerJobId: null,
          providerRequestId: null,
          startedAt: null,
          completedAt: null,
          failedAt: null,
          errorCode: null,
          errorMessage: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
  });

  afterEach(async () => {
    delete process.env.APP_URL;
    await sandbox.cleanup();
  });

  it('cria render com path do próprio usuário e ignora url/mime do cliente', async () => {
    const res = await request(server)
      .post('/renders')
      .send({
        originalImagePath: ownPath,
        originalImageUrl: 'https://evil.example/tracker.png',
        originalImageMimeType: 'text/html',
      })
      .expect(201);

    expect(rendersService.create).toHaveBeenCalledWith(
      USER_A,
      expect.anything(),
      {
        path: ownPath,
        url: `https://api.example.test/${ownPath}`,
        mimeType: 'image/png',
      },
    );
    expect((res.body as { originalImageUrl: string }).originalImageUrl).toBe(
      `https://api.example.test/${ownPath}`,
    );
  });

  it('aceita payload sem url/mime (campos agora opcionais)', async () => {
    await request(server)
      .post('/renders')
      .send({ originalImagePath: ownPath })
      .expect(201);
  });

  it.each([
    ['/etc/passwd', 400],
    ['/proc/self/environ', 400],
    ['../../.env', 400],
    ['uploads/../.env', 400],
    [`uploads/originals/${USER_A}/../../../.env`, 400],
    ['https://evil.example/x.png', 400],
    [`uploads/originals/${USER_B}/${FILE_ID}.png`, 403],
    [`uploads/originals/${USER_A}/${RENDER_ID}.png`, 404],
  ])(
    'rejeita originalImagePath %s com %i e não cria render',
    async (originalImagePath, status) => {
      await writeFile(
        join(sandbox.root, `uploads/originals/${USER_B}/${FILE_ID}.png`),
        PNG_BYTES,
      );
      const res = await request(server)
        .post('/renders')
        .send({ originalImagePath })
        .expect(status);

      expect(rendersService.create).not.toHaveBeenCalled();
      expect(JSON.stringify(res.body)).not.toContain('FAKE_SECRET');
    },
  );

  it('upload grava na pasta do usuário autenticado, tipo pelo conteúdo', async () => {
    const res = await request(server)
      .post('/renders/upload')
      .attach('file', PNG_BYTES, {
        filename: 'foto.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);

    const body = res.body as { path: string; mimeType: string };
    expect(body.mimeType).toBe('image/png');
    expect(body.path.startsWith(`uploads/originals/${USER_A}/`)).toBe(true);
    expect(body.path.endsWith('.png')).toBe(true);
  });

  it('upload rejeita arquivo que não é imagem mesmo com MIME de imagem', async () => {
    await request(server)
      .post('/renders/upload')
      .attach('file', TEXT_BYTES, {
        filename: 'x.png',
        contentType: 'image/png',
      })
      .expect(400);
  });

  describe('POST /renders/:id/process (não executa o Gemini)', () => {
    const renderWith = (status: RenderStatus) => ({
      id: RENDER_ID,
      userId: USER_A,
      originalImageUrl: 'x',
      generatedImageUrl: status === RenderStatus.DONE ? 'y' : null,
      prompt: null,
      status,
      creditsUsed: status === RenderStatus.PENDING ? 0 : 1,
      traceId: null,
      clientRequestId: null,
      providerJobId: null,
      providerRequestId: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    });

    it('PENDING: requisições simultâneas só garantem o job (idempotente) e nunca processam', async () => {
      rendersService.findById.mockResolvedValue(
        renderWith(RenderStatus.PENDING),
      );
      rendersService.enqueue.mockResolvedValue(true);

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(server).post(`/renders/${RENDER_ID}/process`).expect(200),
        ),
      );

      for (const res of responses) {
        expect((res.body as { status: string }).status).toBe('PENDING');
      }
      expect(renderProcessor.processRender).not.toHaveBeenCalled();
      expect(rendersService.findById).toHaveBeenCalledWith(USER_A, RENDER_ID);
    });

    it.each([RenderStatus.DONE, RenderStatus.PROCESSING, RenderStatus.ERROR])(
      'render %s: devolve o estado atual sem enfileirar nem processar',
      async (status) => {
        rendersService.findById.mockResolvedValue(renderWith(status));

        const res = await request(server)
          .post(`/renders/${RENDER_ID}/process`)
          .expect(200);

        expect((res.body as { status: string }).status).toBe(status);
        expect(rendersService.enqueue).not.toHaveBeenCalled();
        expect(renderProcessor.processRender).not.toHaveBeenCalled();
      },
    );

    it('render de outro usuário/inexistente: 404', async () => {
      rendersService.findById.mockResolvedValue(null);
      await request(server).post(`/renders/${RENDER_ID}/process`).expect(404);
      expect(rendersService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('POST /renders — idempotência (header Idempotent-Replayed)', () => {
    it('criação nova: 201 e Idempotent-Replayed: false', async () => {
      const res = await request(server)
        .post('/renders')
        .send({ originalImagePath: ownPath, clientRequestId: 'req-1' })
        .expect(201);
      expect(res.headers['idempotent-replayed']).toBe('false');
    });

    it('replay: mesmo 201 e corpo, Idempotent-Replayed: true', async () => {
      const base = rendersService.create.getMockImplementation()!;
      rendersService.create.mockImplementation((...args: unknown[]) => ({
        ...(base(...args) as object),
        replayed: true,
      }));

      const res = await request(server)
        .post('/renders')
        .send({ originalImagePath: ownPath, clientRequestId: 'req-1' })
        .expect(201);
      expect(res.headers['idempotent-replayed']).toBe('true');
      expect((res.body as { id: string }).id).toBe(RENDER_ID);
    });

    it('mesma chave com payload diferente: 409 IDEMPOTENCY_KEY_REUSED', async () => {
      rendersService.create.mockRejectedValue(
        new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'x',
        }),
      );

      const res = await request(server)
        .post('/renders')
        .send({ originalImagePath: ownPath, clientRequestId: 'req-1' })
        .expect(409);
      expect((res.body as { code: string }).code).toBe(
        'IDEMPOTENCY_KEY_REUSED',
      );
    });
  });

  describe('DELETE /renders/:id', () => {
    it('PROCESSING: 409 RENDER_PROCESSING', async () => {
      rendersService.remove.mockResolvedValue('processing');
      const res = await request(server)
        .delete(`/renders/${RENDER_ID}`)
        .expect(409);
      expect((res.body as { code: string }).code).toBe('RENDER_PROCESSING');
      expect(rendersService.remove).toHaveBeenCalledWith(USER_A, RENDER_ID);
    });

    it('removido: 200 { ok: true }', async () => {
      rendersService.remove.mockResolvedValue('deleted');
      const res = await request(server)
        .delete(`/renders/${RENDER_ID}`)
        .expect(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('inexistente/de outro usuário: 404', async () => {
      rendersService.remove.mockResolvedValue('not-found');
      await request(server).delete(`/renders/${RENDER_ID}`).expect(404);
    });
  });

  it('POST /renders/:id/fail não existe mais (cliente não força ERROR/reembolso)', async () => {
    await request(server)
      .post(`/renders/${RENDER_ID}/fail`)
      .send({ message: 'x' })
      .expect(404);
  });
});
