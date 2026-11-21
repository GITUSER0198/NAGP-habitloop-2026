import { getConfig, getPool } from '@habitloop/shared';

export async function initializeUserTables(): Promise<void> {
  const schema = getConfig().dbSchema;
  const pool = getPool();
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await pool.query(`CREATE TABLE IF NOT EXISTS "${schema}"."tenants" (
    id uuid PRIMARY KEY, name varchar(200) NOT NULL, slug varchar(200) NOT NULL UNIQUE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS "${schema}"."users" (
    id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES "${schema}"."tenants"(id),
    email varchar(254) NOT NULL, password_hash varchar(60) NOT NULL, name varchar(200) NOT NULL,
    timezone varchar(100) NOT NULL, created_at timestamptz NOT NULL,
    CONSTRAINT uq_users_tenant_email UNIQUE (tenant_id, email)
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "ix_users_tenant_id" ON "${schema}"."users" (tenant_id)`);
}
