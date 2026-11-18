/**
 * Isolamento dos testes e2e. Roda antes de qualquer import dos specs, então
 * vale também para `src/queue/connection.ts`, que lê REDIS_URL na carga do
 * módulo (antes de o ConfigModule ler o .env). Sem isso o AppModule
 * conectaria no Redis/PostgreSQL que estivesse em localhost e iniciaria um
 * worker consumindo a fila real.
 *
 * - Worker e recuperação periódica desligados.
 * - Redis e PostgreSQL só locais e descartáveis (E2E_REDIS_URL /
 *   E2E_DATABASE_URL, com defaults em portas dedicadas). O ConfigModule não
 *   sobrescreve variáveis já definidas, então o .env não vaza para cá.
 *
 * Como rodar:
 *   docker run -d --rm --name renderia-e2e-redis -p 127.0.0.1:56379:6379 redis:7-alpine
 *   docker run -d --rm --name renderia-it-pg -e POSTGRES_PASSWORD=it \
 *     -e POSTGRES_DB=renderia_it -p 127.0.0.1:55432:5432 postgres:16
 *   npm run test:e2e
 */
process.env.JWT_SECRET = 'test-secret';
process.env.RENDERS_WORKER_ENABLED = 'false';
process.env.REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://127.0.0.1:56379';
process.env.DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://postgres:it@127.0.0.1:55432/renderia_e2e_test';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

for (const key of ['REDIS_URL', 'DATABASE_URL'] as const) {
  const url = new URL(process.env[key]!);
  if (!LOCAL_HOSTS.includes(url.hostname)) {
    throw new Error(`[E2E setup] ${key} must be local, got ${url.hostname}`);
  }
}

const dbName = new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '');
if (!/test/i.test(dbName)) {
  throw new Error(`[E2E setup] DATABASE_URL must be a test DB, got ${dbName}`);
}
