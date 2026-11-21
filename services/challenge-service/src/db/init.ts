import { getConfig, getPool } from '@habitloop/shared';

export async function initializeChallengeTables(): Promise<void> {
  const schema = getConfig().dbSchema; const pool = getPool();
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await pool.query(`CREATE TABLE IF NOT EXISTS "${schema}"."challenges" (
    id uuid PRIMARY KEY, tenant_id uuid NOT NULL, owner_id uuid NOT NULL, title varchar(200) NOT NULL,
    description text NOT NULL DEFAULT '', visibility varchar(7) NOT NULL, invite_code varchar(8) NOT NULL,
    activity_category varchar(100) NOT NULL, start_date date NOT NULL, end_date date NOT NULL, target_count integer NOT NULL,
    CONSTRAINT uq_challenges_tenant_id UNIQUE (tenant_id,id), CONSTRAINT uq_challenges_tenant_code UNIQUE (tenant_id,invite_code)
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "ix_challenges_tenant" ON "${schema}"."challenges" (tenant_id)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS "${schema}"."participants" (
    challenge_id uuid NOT NULL, user_id uuid NOT NULL, tenant_id uuid NOT NULL, status varchar(8) NOT NULL, joined_at timestamptz,
    CONSTRAINT pk_participants PRIMARY KEY (challenge_id,user_id,tenant_id),
    CONSTRAINT fk_participant_challenge_tenant FOREIGN KEY (tenant_id,challenge_id) REFERENCES "${schema}"."challenges"(tenant_id,id)
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "ix_participants_user" ON "${schema}"."participants" (tenant_id,user_id,status)`);
}
