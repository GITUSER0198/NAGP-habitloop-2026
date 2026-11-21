import { randomUUID } from 'node:crypto';
import { DataType, newDb } from 'pg-mem';

process.env.JWT_SECRET ??= 'test-jwt-secret-with-enough-entropy';
process.env.INTERNAL_TOKEN ??= 'test-internal-token';
process.env.DB_SCHEMA ??= 'users_test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.WEB_PORT ??= '47809';
const { setPoolForTests, setDbForTests } = await import('@habitloop/shared');
const memory = newDb({ autoCreateForeignKeyIndices: true });
memory.public.registerFunction({ name: 'gen_random_uuid', args: [], returns: DataType.uuid, implementation: randomUUID, impure: true });
const MemoryPool = memory.adapters.createPg().Pool;
const pool = new MemoryPool();
// pg-mem provides the pool operations used here but does not declare the full pg Pool type.
setPoolForTests(pool as never);
const { drizzle } = await import('drizzle-orm/pg-proxy');
// The proxy converts pg-mem object rows to positional rows for Drizzle's query interface.
setDbForTests(drizzle(async (sql, params) => {
  const result = await pool.query(sql, params);
  return { rows: result.rows.map(row => Object.values(row)) };
}) as never);
