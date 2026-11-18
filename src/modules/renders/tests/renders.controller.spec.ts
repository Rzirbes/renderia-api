jest.mock('../renders.queue', () => ({ rendersQueue: { add: jest.fn() } }));

import request from 'supertest';
import { Server } from 'http';
import {
  CanActivate,
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

  const rendersService = { create: jest.fn() };
  const ownPath = `uploads/originals/${USER_A}/${FILE_ID}.png`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RendersController],
      providers: [
        StorageService,
        { provide: RendersService, useValue: rendersService },
        { provide: RenderProcessorService, useValue: {} },
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
    await app.init();
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
});
