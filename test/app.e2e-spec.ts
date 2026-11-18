import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'http';
import { AppModule } from './../src/app.module';

/**
 * Smoke test do AppModule completo (sem mocks de guard): a aplicação sobe
 * com a infraestrutura isolada de test/setup-e2e.ts e as rotas protegidas
 * exigem autenticação.
 *
 * O antigo `GET /` -> 'Hello World!' era do scaffold do Nest: o
 * AppController nunca foi registrado no AppModule, então a API não expõe `/`.
 */
describe('AppModule (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET / não é exposto (404)', async () => {
    await request(server).get('/').expect(404);
  });

  it.each(['/renders', '/auth/me', '/credits/me'])(
    'GET %s sem token: 401',
    async (path) => {
      await request(server).get(path).expect(401);
    },
  );

  it('DELETE /renders/:id sem token: 401 (nada é removido)', async () => {
    await request(server)
      .delete('/renders/11111111-1111-1111-1111-111111111111')
      .expect(401);
  });
});
