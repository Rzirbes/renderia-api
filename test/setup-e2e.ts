process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL =
  'postgresql://user:pass@localhost:5432/renderia_test';

console.log('[E2E setup] DATABASE_URL =', process.env.DATABASE_URL);
