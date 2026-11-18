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
import { Render, RenderStatus } from '@prisma/client';

import { AppModule } from '../../src/app.module';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt.guard';
import { RendersService } from '../../src/modules/renders/renders.service';
import { StorageService } from '../../src/modules/renders/storage.service';
import { RenderResponse } from '../../src/modules/renders/dto/render-response.dto';

type JwtUser = { userId: string; email: string };

const now = new Date('2026-03-04T18:46:54.000Z');

function mockRender(partial: Partial<Render> = {}): Render {
  return {
    originalImagePath: null,
    generatedImagePath: null,
    presetId: null,
    providerModel: null,
    sourceImageMimeType: null,
    outputImageMimeType: null,
    parentRenderId: null,
    traceId: null,
    clientRequestId: null,
    providerJobId: null,
    providerRequestId: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    errorCode: null,
    errorMessage: null,
    errorMeta: null,
    id: '11111111-1111-1111-1111-111111111111',
    userId: 'u1',
    originalImageUrl: 'https://picsum.photos/200/300',
    generatedImageUrl: null,
    prompt: null,
    status: RenderStatus.PENDING,
    creditsUsed: 0,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

class FakeJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtUser }>();

    req.user = { userId: 'u1', email: 'romulo@test.com' };
    return true;
  }
}

function bodyAs<T>(res: { body: unknown }): T {
  return res.body as T;
}

type ListResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: RenderResponse[];
};

describe('Renders (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  // UUIDs válidos (por causa do ParseUUIDPipe)
  const id1 = '11111111-1111-1111-1111-111111111111';
  const id2 = '22222222-2222-2222-2222-222222222222';
  const idMissing = '33333333-3333-3333-3333-333333333333';

  type RendersServiceMock = jest.Mocked<
    Pick<RendersService, 'create' | 'list' | 'findById' | 'remove' | 'enqueue'>
  >;

  let rendersServiceMock: RendersServiceMock;

  // O path/URL/MIME da imagem original são resolvidos pelo servidor a partir
  // de um upload do próprio usuário (a validação real do filesystem é
  // coberta em renders.controller.spec.ts e storage.service.spec.ts).
  const ownPath =
    'uploads/originals/u1/44444444-4444-4444-8444-444444444444.png';
  const resolvedImage = {
    path: ownPath,
    url: `https://api.example.test/${ownPath}`,
    mimeType: 'image/png',
  };
  const storageServiceMock = {
    resolveUserOriginalImage: jest.fn(),
  };

  beforeAll(async () => {
    rendersServiceMock = {
      create: jest.fn(),
      list: jest.fn(),
      findById: jest.fn(),
      remove: jest.fn(),
      enqueue: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeJwtGuard)
      .overrideProvider(RendersService)
      .useValue(rendersServiceMock)
      .overrideProvider(StorageService)
      .useValue(storageServiceMock)
      .compile();

    app = moduleRef.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );

    await app.init();
    server = app.getHttpServer() as unknown as Server;
  });

  beforeEach(() => {
    rendersServiceMock.create.mockReset();
    rendersServiceMock.list.mockReset();
    rendersServiceMock.findById.mockReset();
    rendersServiceMock.remove.mockReset();
    rendersServiceMock.enqueue.mockReset();
    storageServiceMock.resolveUserOriginalImage.mockReset();
    storageServiceMock.resolveUserOriginalImage.mockResolvedValue(
      resolvedImage,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /renders creates a render for the logged user', async () => {
    const payload = {
      originalImagePath: ownPath,
      // ignorado pelo servidor: a URL é derivada do path validado
      originalImageUrl: 'https://evil.example/x.png',
      prompt: 'blue hour',
      clientRequestId: 'req-1',
    };

    rendersServiceMock.create.mockImplementation((userId, _dto, img) =>
      Promise.resolve({
        render: mockRender({
          id: id1,
          userId,
          originalImageUrl: img.url,
          originalImagePath: img.path,
          prompt: payload.prompt,
          clientRequestId: payload.clientRequestId,
        }),
        replayed: false,
      }),
    );

    const res = await request(server)
      .post('/renders')
      .send(payload)
      .expect(201);

    expect(storageServiceMock.resolveUserOriginalImage).toHaveBeenCalledWith(
      'u1',
      ownPath,
    );
    expect(rendersServiceMock.create).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        originalImagePath: ownPath,
        prompt: payload.prompt,
        clientRequestId: 'req-1',
      }),
      resolvedImage,
    );
    expect(res.headers['idempotent-replayed']).toBe('false');

    const body = bodyAs<RenderResponse>(res);
    expect(body.id).toBe(id1);
    expect(body.userId).toBe('u1');
    expect(body.originalImageUrl).toBe(resolvedImage.url);
    expect(body.prompt).toBe(payload.prompt);
  });

  it('POST /renders without originalImagePath returns 400 (no render created)', async () => {
    await request(server)
      .post('/renders')
      .send({ originalImageUrl: 'https://picsum.photos/200/300' })
      .expect(400);

    expect(rendersServiceMock.create).not.toHaveBeenCalled();
  });

  it('POST /renders replay returns the same render with Idempotent-Replayed: true', async () => {
    rendersServiceMock.create.mockResolvedValue({
      render: mockRender({ id: id1, clientRequestId: 'req-1' }),
      replayed: true,
    });

    const res = await request(server)
      .post('/renders')
      .send({ originalImagePath: ownPath, clientRequestId: 'req-1' })
      .expect(201);

    expect(res.headers['idempotent-replayed']).toBe('true');
    expect(bodyAs<RenderResponse>(res).id).toBe(id1);
  });

  it('GET /renders lists only renders of the logged user (pagination)', async () => {
    rendersServiceMock.list.mockResolvedValue({
      page: 1,
      pageSize: 10,
      total: 2,
      items: [
        mockRender({ id: id1, prompt: 'p1' }),
        mockRender({ id: id2, prompt: 'p2' }),
      ],
    });

    const res = await request(server)
      .get('/renders')
      .query({ page: 1, pageSize: 10 })
      .expect(200);

    expect(rendersServiceMock.list).toHaveBeenCalledWith('u1', {
      page: 1,
      pageSize: 10,
    });

    const body = bodyAs<ListResponse>(res);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(10);
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
    expect(body.items.every((i) => i.userId === 'u1')).toBe(true);
  });

  it('GET /renders/:id returns 404 when render does not exist', async () => {
    rendersServiceMock.findById.mockResolvedValue(null);

    await request(server).get(`/renders/${idMissing}`).expect(404);

    expect(rendersServiceMock.findById).toHaveBeenCalledWith('u1', idMissing);
  });

  it('GET /renders/:id returns the render when it exists and belongs to the user', async () => {
    rendersServiceMock.findById.mockResolvedValue(
      mockRender({ id: id1, prompt: 'x' }),
    );

    const res = await request(server).get(`/renders/${id1}`).expect(200);

    expect(rendersServiceMock.findById).toHaveBeenCalledWith('u1', id1);

    const body = bodyAs<RenderResponse>(res);
    expect(body.id).toBe(id1);
  });

  it('DELETE /renders/:id returns 200 when removed', async () => {
    rendersServiceMock.remove.mockResolvedValue('deleted');

    const res = await request(server).delete(`/renders/${id1}`).expect(200);

    expect(rendersServiceMock.remove).toHaveBeenCalledWith('u1', id1);
    expect(res.body).toEqual({ ok: true });
  });

  it('DELETE /renders/:id returns 404 when render does not exist', async () => {
    rendersServiceMock.remove.mockResolvedValue('not-found');

    await request(server).delete(`/renders/${idMissing}`).expect(404);

    expect(rendersServiceMock.remove).toHaveBeenCalledWith('u1', idMissing);
  });

  it('DELETE /renders/:id returns 409 while the render is PROCESSING', async () => {
    rendersServiceMock.remove.mockResolvedValue('processing');

    const res = await request(server).delete(`/renders/${id1}`).expect(409);

    expect((res.body as { code: string }).code).toBe('RENDER_PROCESSING');
  });

  type ProcessResponse = RenderResponse;

  it('POST /renders/:id/process só garante o job na fila e é idempotente', async () => {
    const pending = mockRender({ id: id1, status: RenderStatus.PENDING });
    rendersServiceMock.findById.mockResolvedValue(pending);
    rendersServiceMock.enqueue.mockResolvedValue(true);

    const [r1, r2] = await Promise.all([
      request(server).post(`/renders/${id1}/process`).expect(200),
      request(server).post(`/renders/${id1}/process`).expect(200),
    ]);

    expect(bodyAs<ProcessResponse>(r1).status).toBe(RenderStatus.PENDING);
    expect(bodyAs<ProcessResponse>(r2).status).toBe(RenderStatus.PENDING);
    // enqueue é idempotente por jobId = renderId; nunca processa aqui.
    expect(rendersServiceMock.enqueue).toHaveBeenCalledWith(pending);

    const done = mockRender({
      id: id1,
      status: RenderStatus.DONE,
      generatedImageUrl: `https://fake-cdn.renderia.local/renders/${id1}.png`,
    });
    rendersServiceMock.findById.mockResolvedValue(done);
    rendersServiceMock.enqueue.mockClear();

    const r3 = await request(server)
      .post(`/renders/${id1}/process`)
      .expect(200);
    expect(bodyAs<ProcessResponse>(r3).status).toBe(RenderStatus.DONE);
    expect(rendersServiceMock.enqueue).not.toHaveBeenCalled();
  });
});
