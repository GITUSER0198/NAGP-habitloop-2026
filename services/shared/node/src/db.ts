import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getConfig } from './config.js';
import type * as schema from './schema-types.js';

let pool: Pool | undefined;
let database: NodePgDatabase<typeof schema> | undefined;
export function getPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: getConfig().databaseUrl, options: `-c search_path=${getConfig().dbSchema},public` });
  return pool;
}
export function setPoolForTests(testPool: Pool): void { pool = testPool; database = undefined; }
export function setDbForTests(testDatabase: unknown): void { database = testDatabase as NodePgDatabase<typeof schema>; }
export function getDb(): NodePgDatabase<typeof schema> {
  if (!database) database = drizzle(getPool());
  return database;
}
export async function initializeDatabase(attempts = 6, initialDelay = 500): Promise<void> {
  const cfg = getConfig();
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await getPool().query(`CREATE SCHEMA IF NOT EXISTS "${cfg.dbSchema}"`);
      return;
    } catch (error) {
      if (attempt === attempts) throw new Error(`Database unavailable after ${attempts} connection attempts`, { cause: error });
      await new Promise(resolve => setTimeout(resolve, Math.min(initialDelay * 2 ** (attempt - 1), 8000)));
    }
  }
}
export async function closeDatabase(): Promise<void> { await pool?.end(); pool = undefined; database = undefined; }
