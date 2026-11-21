import { getConfig, getPool } from '@habitloop/shared';

// Same table and index names the Python service created, so an existing database keeps working.
export async function initializeRecommendationTables(): Promise<void> {
  const schema = getConfig().dbSchema;
  const pool = getPool();
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await pool.query(`CREATE TABLE IF NOT EXISTS "${schema}"."recommendations" (
    id uuid PRIMARY KEY, tenant_id uuid NOT NULL, user_id uuid NOT NULL, activity_id uuid NOT NULL, kind varchar(10) NOT NULL,
    current_value jsonb NOT NULL, suggested_value jsonb NOT NULL, reason varchar(1000) NOT NULL, confidence varchar(6) NOT NULL,
    status varchar(9) NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "ix_recommendations_tenant_id" ON "${schema}"."recommendations" (tenant_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "ix_recommendations_user_id" ON "${schema}"."recommendations" (user_id)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_pending_recommendation_values" ON "${schema}"."recommendations"
    (tenant_id, user_id, activity_id, kind, current_value, suggested_value) WHERE status = 'pending'`);
}
