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
import { PrismaService } from '../../src/database/prisma/prisma.service';
import { AuthService } from '../../src/modules/auth/auth.service';

type JwtUser = { userId: string; email: string };

type ErrorResponse = {
  message: string[];
  error: string;
  statusCode: number;
};

class FakeJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtUser }>();
    req.user = { userId: 'u1', email: 'romulo@test.com' };
    return true;
  }
}

describe('Auth (e2e)', () => {
  let app: INestApplication;

  const authServiceMock = {
    register: jest.fn(),
    login: jest.fn(),
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeJwtGuard)
      .overrideProvider(PrismaService)
      .useValue({
        $connect: () => undefined,
        $disconnect: () => undefined,
      })
      .overrideProvider(AuthService)
      .useValue(authServiceMock)
      .compile();

    app = moduleRef.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('POST /auth/register returns access token', async () => {
    authServiceMock.register.mockResolvedValue({
      accessToken: 'fake-token',
    });

    const payload = {
      name: 'Rômulo',
      email: 'romulo@test.com',
      password: '12345678',
    };

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send(payload)
      .expect(201);

    expect(res.body).toEqual({ accessToken: 'fake-token' });
    expect(authServiceMock.register).toHaveBeenCalledTimes(1);
    expect(authServiceMock.register).toHaveBeenCalledWith(payload);
  });

  it('GET /auth/me returns current user', async () => {
    const res = await request(app.getHttpServer()).get('/auth/me').expect(200);
    expect(res.body).toEqual({ userId: 'u1', email: 'romulo@test.com' });
  });

  it('POST /auth/register returns 400 for invalid email', async () => {
    const payload = {
      name: 'Rômulo',
      email: 'email-invalido',
      password: '123456',
    };

    await request(app.getHttpServer())
      .post('/auth/register')
      .send(payload)
      .expect(400);

    expect(authServiceMock.register).not.toHaveBeenCalled();
  });

  it('POST /auth/register returns 400 when payload has extra fields', async () => {
    const payload = {
      name: 'Rômulo',
      email: 'romulo@test.com',
      password: '12345678',
      role: 'ADMIN',
    };

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send(payload)
      .expect(400);

    const body = res.body as ErrorResponse;

    expect(body.message).toEqual(
      expect.arrayContaining(['property role should not exist']),
    );

    expect(authServiceMock.register).not.toHaveBeenCalled();
  });
});
