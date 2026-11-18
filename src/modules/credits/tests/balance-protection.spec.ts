import request from 'supertest';
import { Server } from 'http';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { Request } from 'express';

import { CreditsController } from '../credits.controller';
import { CreditsService } from '../credits.service';
import { UsersController } from '../../users/users.controller';
import { UsersService } from '../../users/users.service';
import { AuthController } from '../../auth/auth.controller';
import { AuthService } from '../../auth/auth.service';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

class FakeJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: { userId: string; email: string } }>();
    req.user = { userId: USER_ID, email: 'u@test.com' };
    return true;
  }
}

/**
 * Regressão: usuários comuns não podem aumentar o próprio saldo por
 * nenhuma rota HTTP.
 */
describe('Proteção de saldo de créditos (HTTP)', () => {
  let app: INestApplication;
  let server: Server;

  const creditsService = {
    getMe: jest.fn(),
    listTxs: jest.fn(),
    addCredits: jest.fn(),
    useCredits: jest.fn(),
  };
  const usersService = { findById: jest.fn(), updateMe: jest.fn() };
  const authService = {
    register: jest.fn(),
    login: jest.fn(),
    me: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CreditsController, UsersController, AuthController],
      providers: [
        { provide: CreditsService, useValue: creditsService },
        { provide: UsersService, useValue: usersService },
        { provide: AuthService, useValue: authService },
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

  beforeEach(() => jest.clearAllMocks());

  it.each([
    { amount: 5, type: 'BONUS' },
    { amount: 1_000_000, type: 'PURCHASE' },
    { amount: 10, type: 'REFUND' },
  ])('POST /credits/me/add não existe (404) para %o', async (body) => {
    await request(server).post('/credits/me/add').send(body).expect(404);
    expect(creditsService.addCredits).not.toHaveBeenCalled();
  });

  it('nenhuma rota do CreditsController chama addCredits', () => {
    const proto = CreditsController.prototype as unknown as Record<
      string,
      unknown
    >;
    const routes = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor')
      .map((name) => ({
        name,
        method: Reflect.getMetadata(METHOD_METADATA, proto[name] as object) as
          | RequestMethod
          | undefined,
        path: Reflect.getMetadata(PATH_METADATA, proto[name] as object) as
          | string
          | undefined,
      }))
      .filter((r) => r.method !== undefined);

    expect(routes.map((r) => r.path).sort()).toEqual(
      ['me', 'me/txs', 'me/use'].sort(),
    );
    expect(routes.some((r) => /add/i.test(r.name))).toBe(false);
  });

  it('POST /credits/me/use com valor negativo é rejeitado (não vira crédito)', async () => {
    await request(server)
      .post('/credits/me/use')
      .send({ amount: -100 })
      .expect(400);
    expect(creditsService.useCredits).not.toHaveBeenCalled();
  });

  it('PATCH /users/me não aceita campo credits', async () => {
    await request(server)
      .patch('/users/me')
      .send({ name: 'x', credits: 9999 })
      .expect(400);
    expect(usersService.updateMe).not.toHaveBeenCalled();
  });

  it('POST /auth/register não aceita campo credits', async () => {
    await request(server)
      .post('/auth/register')
      .send({ email: 'n@test.com', password: '12345678', credits: 9999 })
      .expect(400);
    expect(authService.register).not.toHaveBeenCalled();
  });
});
