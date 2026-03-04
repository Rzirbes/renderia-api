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
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt.guard';
import { UsersService } from '../../src/modules/users/users.service';

type JwtUser = { userId: string; email: string };

type MeResponseBody = {
  id: string;
  name: string | null;
  email: string;
  credits: number;
  createdAt: string;
  updatedAt: string;
};

function bodyAs<T>(res: { body: unknown }): T {
  return res.body as T;
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

describe('Users (e2e)', () => {
  let app: INestApplication;

  const usersServiceMock = {
    findById: jest.fn(),
    updateMe: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeJwtGuard)
      .overrideProvider(UsersService)
      .useValue(usersServiceMock)
      .compile();

    app = moduleRef.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false, // <- mantendo do jeito que tu colocou
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

  it('GET /users/me returns 200 and user response dto', async () => {
    usersServiceMock.findById.mockResolvedValue({
      id: 'u1',
      name: 'Rômulo',
      email: 'romulo@test.com',
      password: 'HASHED',
      credits: 10,
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-02T00:00:00.000Z'),
    });

    const res = await request(app.getHttpServer()).get('/users/me').expect(200);

    expect(usersServiceMock.findById).toHaveBeenCalledWith('u1');

    const body = bodyAs<MeResponseBody>(res);

    expect(body).toEqual({
      id: 'u1',
      name: 'Rômulo',
      email: 'romulo@test.com',
      credits: 10,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
    });

    // não acessa body.password (evita "unsafe")
    expect('password' in (res.body as object)).toBe(false);
  });

  it('PATCH /users/me returns 200 and updates name', async () => {
    usersServiceMock.updateMe.mockResolvedValue({
      id: 'u1',
      name: 'Novo Nome',
      email: 'romulo@test.com',
      password: 'HASHED',
      credits: 10,
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-02T00:00:00.000Z'),
    });

    const res = await request(app.getHttpServer())
      .patch('/users/me')
      .send({ name: 'Novo Nome' })
      .expect(200);

    expect(usersServiceMock.updateMe).toHaveBeenCalledWith('u1', {
      name: 'Novo Nome',
    });

    const body = bodyAs<MeResponseBody>(res);

    expect(body.name).toBe('Novo Nome');
    expect('password' in (res.body as object)).toBe(false);
  });

  it('PATCH /users/me ignores extra fields when forbidNonWhitelisted=false', async () => {
    usersServiceMock.updateMe.mockResolvedValue({
      id: 'u1',
      name: 'Rômulo',
      email: 'romulo@test.com',
      password: 'HASHED',
      credits: 10,
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-02T00:00:00.000Z'),
    });

    const res = await request(app.getHttpServer())
      .patch('/users/me')
      .send({ name: 'Rômulo', role: 'ADMIN' })
      .expect(200);

    expect(usersServiceMock.updateMe).toHaveBeenCalledWith('u1', {
      name: 'Rômulo',
    });

    const body = bodyAs<MeResponseBody>(res);
    expect(body.name).toBe('Rômulo');
    expect('password' in (res.body as object)).toBe(false);
  });
});
