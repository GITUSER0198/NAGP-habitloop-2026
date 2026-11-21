process.env.JWT_SECRET ??= 'test-jwt-secret-with-enough-entropy';
process.env.INTERNAL_TOKEN ??= 'test-internal-token';
process.env.DB_SCHEMA ??= 'analytics_test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.WEB_PORT ??= '47809';
process.env.LOG_LEVEL = 'silent';
const { newDb } = await import('pg-mem');
const memory = newDb(); const pool = new (memory.adapters.createPg().Pool)();
const shared = await import('@habitloop/shared'); shared.setPoolForTests(pool as never);
