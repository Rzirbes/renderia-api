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
import { RenderResponse } from '../../src/modules/renders/dto/render-response.dto';

type JwtUser = { userId: string; email: string };

const now = new Date('2026-03-04T18:46:54.000Z');

function mockRender(partial: Partial<Render> = {}): Render {
  return {
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
    Pick<RendersService, 'create' | 'list' | 'findById' | 'remove'>
  >;

  let rendersServiceMock: RendersServiceMock;

  beforeAll(async () => {
    rendersServiceMock = {
      create: jest.fn(),
      list: jest.fn(),
      findById: jest.fn(),
      remove: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeJwtGuard)
      .overrideProvider(RendersService)
      .useValue(rendersServiceMock)
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
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /renders creates a render for the logged user', async () => {
    const payload = {
      originalImageUrl: 'https://picsum.photos/200/300',
      prompt: 'blue hour',
    };

    rendersServiceMock.create.mockResolvedValue(
      mockRender({
        id: id1,
        originalImageUrl: payload.originalImageUrl,
        prompt: payload.prompt,
      }),
    );

    const res = await request(server)
      .post('/renders')
      .send(payload)
      .expect(201);

    expect(rendersServiceMock.create).toHaveBeenCalledWith('u1', {
      originalImageUrl: payload.originalImageUrl,
      prompt: payload.prompt,
    });

    const body = bodyAs<RenderResponse>(res);
    expect(body.id).toBe(id1);
    expect(body.userId).toBe('u1');
    expect(body.originalImageUrl).toBe(payload.originalImageUrl);
    expect(body.prompt).toBe(payload.prompt);
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
    rendersServiceMock.remove.mockResolvedValue(true);

    const res = await request(server).delete(`/renders/${id1}`).expect(200);

    expect(rendersServiceMock.remove).toHaveBeenCalledWith('u1', id1);
    expect(res.body).toEqual({ ok: true });
  });

  it('DELETE /renders/:id returns 404 when render does not exist', async () => {
    rendersServiceMock.remove.mockResolvedValue(false);

    await request(server).delete(`/renders/${idMissing}`).expect(404);

    expect(rendersServiceMock.remove).toHaveBeenCalledWith('u1', idMissing);
  });
});
