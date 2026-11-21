import { getConfig, getPool } from '@habitloop/shared';

// Idempotent boot migration. A users table from the first (single-tenant-per-account) layout is
// kept aside under a legacy name so the new global-accounts tables can be created next to it.
export async function initializeUserTables(): Promise<void> {
  const schema = getConfig().dbSchema;
  const pool = getPool();
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  const legacy = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'users' AND column_name = 'tenant_id'`, [schema]);
  if (legacy.rows.length > 0) {
    await pool.query(`DROP INDEX IF EXISTS "${schema}"."ix_users_tenant_id"`);
    await pool.query(`ALTER TABLE "${schema}"."users" RENAME TO "users_legacy_v1"`);
    await pool.query(`ALTER TABLE "${schema}"."tenants" RENAME TO "tenants_legacy_v1"`);
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS "${schema}"."tenants" (
    id uuid PRIMARY KEY, name varchar(200) NOT NULL, slug varchar(200) NOT NULL UNIQUE,
    kind varchar(20) NOT NULL, description varchar(500) NOT NULL, owner_id uuid, created_at timestamptz NOT NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS "${schema}"."users" (
    id uuid PRIMARY KEY, email varchar(254) NOT NULL UNIQUE, password_hash varchar(60) NOT NULL,
    name varchar(200) NOT NULL, timezone varchar(100) NOT NULL, last_tenant_id uuid, created_at timestamptz NOT NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS "${schema}"."memberships" (
    user_id uuid NOT NULL REFERENCES "${schema}"."users"(id), tenant_id uuid NOT NULL REFERENCES "${schema}"."tenants"(id),
    role varchar(20) NOT NULL, joined_at timestamptz NOT NULL,
    CONSTRAINT uq_memberships_user_tenant UNIQUE (user_id, tenant_id)
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "ix_memberships_tenant_id" ON "${schema}"."memberships" (tenant_id)`);
}
