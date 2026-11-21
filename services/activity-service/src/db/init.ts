import { getConfig, getPool } from '@habitloop/shared';

export async function initializeActivityTables(): Promise<void> {
  const schema = getConfig().dbSchema;
  const pool = getPool();
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await pool.query(`CREATE TABLE IF NOT EXISTS "${schema}"."activities" (
    id uuid PRIMARY KEY, tenant_id uuid NOT NULL, user_id uuid NOT NULL, name varchar(200) NOT NULL,
    category varchar(100) NOT NULL, frequency varchar(10) NOT NULL, days_of_week integer[] NOT NULL,
    preferred_time varchar(5) NOT NULL, target_per_week integer NOT NULL, active boolean NOT NULL DEFAULT true
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "ix_activities_tenant" ON "${schema}"."activities" (tenant_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "ix_activities_user" ON "${schema}"."activities" (user_id)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS "${schema}"."activity_logs" (
    id uuid PRIMARY KEY, tenant_id uuid NOT NULL, user_id uuid NOT NULL, activity_id uuid NOT NULL REFERENCES "${schema}"."activities"(id),
    status varchar(10) NOT NULL, logged_at timestamptz NOT NULL, source varchar(10) NOT NULL,
    source_event_id varchar(255) UNIQUE, duration_min integer, metadata jsonb NOT NULL DEFAULT '{}'
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "ix_activity_logs_tenant" ON "${schema}"."activity_logs" (tenant_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "ix_activity_logs_activity" ON "${schema}"."activity_logs" (activity_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "ix_activity_logs_logged_at" ON "${schema}"."activity_logs" (logged_at)`);
}
