import { randomUUID } from 'node:crypto';
import { DataType, newDb } from 'pg-mem';
process.env.JWT_SECRET ??= 'test-jwt-secret-with-enough-entropy';
process.env.INTERNAL_TOKEN ??= 'test-internal-token';
process.env.DB_SCHEMA ??= 'challenges_test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.WEB_PORT ??= '47809';
const { setPoolForTests, setDbForTests } = await import('@habitloop/shared');
const memory = newDb({ autoCreateForeignKeyIndices: true });
memory.public.registerFunction({ name: 'gen_random_uuid', args: [], returns: DataType.uuid, implementation: randomUUID, impure: true });
const pool = new (memory.adapters.createPg().Pool)();
setPoolForTests(pool as never);
const { drizzle } = await import('drizzle-orm/pg-proxy');
setDbForTests(drizzle(async (query, params) => {
  const result = await pool.query(query, params);
  // pg returns SQL dates as strings; pg-mem returns Date objects instead.
  return { rows: result.rows.map(row => Object.entries(row).map(([key, value]) =>
    (key === 'start_date' || key === 'end_date') && value instanceof Date ? value.toISOString().slice(0, 10) : value)) };
}) as never);
