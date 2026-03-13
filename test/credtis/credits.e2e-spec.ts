import request from 'supertest';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Request } from 'express';

import { AppModule } from '../../src/app.module';
import { JwtAuthGuard } from '../../src/modules/auth/infrastructure/guards/jwt.guard';
import { CreditsService } from '../../src/modules/credits/credits.service';

type JwtUser = { userId: string; email: string };

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

type MeResponse = { credits: number; lastTxs?: unknown[] };
type AddUseResponse = {
  credits: number;
  tx: { id: string; amount: number; type: string };
};
type ListTxsResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: unknown[];
};

describe('Credits (e2e)', () => {
  let app: INestApplication;

  const creditsServiceMock = {
    getMe: jest.fn(),
    listTxs: jest.fn(),
    addCredits: jest.fn(),
    useCredits: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeJwtGuard)
      .overrideProvider(CreditsService)
      .useValue(creditsServiceMock)
      .compile();

    app = moduleRef.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
        transformOptions: { enableImplicitConversion: true },
      }),
    );

    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /credits/me returns 200 and balance', async () => {
    creditsServiceMock.getMe.mockResolvedValue({
      credits: 10,
      lastTxs: [],
    });

    const res = await request(app.getHttpServer())
      .get('/credits/me')
      .expect(200);

    expect(creditsServiceMock.getMe).toHaveBeenCalledWith('u1');

    const body = bodyAs<MeResponse>(res);
    expect(body.credits).toBe(10);
  });

  it('POST /credits/me/add returns 201 and adds credits', async () => {
    creditsServiceMock.addCredits.mockResolvedValue({
      credits: 15,
      tx: { id: 'tx1', amount: 5, type: 'BONUS' },
    });

    const res = await request(app.getHttpServer())
      .post('/credits/me/add')
      .send({ amount: 5, type: 'BONUS' })
      .expect(201);

    expect(creditsServiceMock.addCredits).toHaveBeenCalledWith({
      userId: 'u1',
      amount: 5,
      type: 'BONUS',
      meta: undefined,
    });

    const body = bodyAs<AddUseResponse>(res);
    expect(body.credits).toBe(15);
    expect(body.tx.type).toBe('BONUS');
  });

  it('POST /credits/me/use returns 201 and consumes credits', async () => {
    creditsServiceMock.useCredits.mockResolvedValue({
      credits: 7,
      tx: { id: 'tx2', amount: -3, type: 'USAGE' },
    });

    const res = await request(app.getHttpServer())
      .post('/credits/me/use')
      .send({ amount: 3 })
      .expect(201);

    expect(creditsServiceMock.useCredits).toHaveBeenCalledWith({
      userId: 'u1',
      amount: 3,
      meta: undefined,
    });

    const body = bodyAs<AddUseResponse>(res);
    expect(body.credits).toBe(7);
  });

  it('GET /credits/me/txs returns 200 and paginated items', async () => {
    creditsServiceMock.listTxs.mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 1,
      items: [{ id: 'tx1' }],
    });

    const res = await request(app.getHttpServer())
      .get('/credits/me/txs')
      .expect(200);

    expect(creditsServiceMock.listTxs).toHaveBeenCalledWith('u1', 1, 20);

    const body = bodyAs<ListTxsResponse>(res);
    expect(body.total).toBe(1);
    expect(body.items.length).toBeGreaterThan(0);
  });

  it('GET /credits/me/txs supports query params page/pageSize', async () => {
    creditsServiceMock.listTxs.mockResolvedValue({
      page: 2,
      pageSize: 5,
      total: 0,
      items: [],
    });

    await request(app.getHttpServer())
      .get('/credits/me/txs?page=2&pageSize=5')
      .expect(200);

    expect(creditsServiceMock.listTxs).toHaveBeenCalledWith('u1', 2, 5);
  });
});
