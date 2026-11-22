import { randomUUID } from 'node:crypto';
import { getConfig, getPool } from '@habitloop/shared';

export async function initializeChallengeTables(): Promise<void> {
  const schema = getConfig().dbSchema; const pool = getPool();
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await pool.query(`CREATE TABLE IF NOT EXISTS "${schema}"."challenges" (
    id uuid PRIMARY KEY, tenant_id uuid NOT NULL, owner_id uuid NOT NULL, title varchar(200) NOT NULL,
    description text NOT NULL DEFAULT '', visibility varchar(7) NOT NULL,
    activity_category varchar(100) NOT NULL, start_date date NOT NULL, end_date date NOT NULL, target_count integer NOT NULL,
    CONSTRAINT uq_challenges_tenant_id UNIQUE (tenant_id,id)
  )`);
  // Boot migration: invite codes are gone and visibility is now public | members.
  await pool.query(`ALTER TABLE "${schema}"."challenges" DROP COLUMN IF EXISTS invite_code`);
  await pool.query(`UPDATE "${schema}"."challenges" SET visibility = 'members' WHERE visibility = 'private'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "ix_challenges_tenant" ON "${schema}"."challenges" (tenant_id)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS "${schema}"."participants" (
    challenge_id uuid NOT NULL, user_id uuid NOT NULL, tenant_id uuid NOT NULL, status varchar(8) NOT NULL, joined_at timestamptz,
    CONSTRAINT pk_participants PRIMARY KEY (challenge_id,user_id,tenant_id),
    CONSTRAINT fk_participant_challenge_tenant FOREIGN KEY (tenant_id,challenge_id) REFERENCES "${schema}"."challenges"(tenant_id,id)
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "ix_participants_user" ON "${schema}"."participants" (tenant_id,user_id,status)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS "${schema}"."posts" (
    id uuid PRIMARY KEY, tenant_id uuid NOT NULL, challenge_id uuid NOT NULL, author_id uuid NOT NULL, caption text NOT NULL DEFAULT '',
    image_url text, caring_value varchar(100), created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT uq_posts_challenge UNIQUE (challenge_id)
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "ix_posts_tenant_created" ON "${schema}"."posts" (tenant_id,created_at)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS "${schema}"."post_likes" (
    post_id uuid NOT NULL, user_id uuid NOT NULL, tenant_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_post_likes UNIQUE (post_id,user_id)
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "ix_post_likes_post" ON "${schema}"."post_likes" (post_id)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS "${schema}"."post_comments" (
    id uuid PRIMARY KEY, post_id uuid NOT NULL, tenant_id uuid NOT NULL, author_id uuid NOT NULL, body varchar(1000) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "ix_post_comments_post" ON "${schema}"."post_comments" (post_id,created_at)`);
  // Boot migration: challenges created before wall posts existed get one post, so every challenge shows in the feed.
  const missing = await pool.query(`SELECT c.id, c.tenant_id, c.owner_id, c.description, c.start_date FROM "${schema}"."challenges" c
    LEFT JOIN "${schema}"."posts" p ON p.challenge_id = c.id WHERE p.id IS NULL`);
  for (const row of missing.rows as { id: string; tenant_id: string; owner_id: string; description: string; start_date: string }[]) {
    await pool.query(`INSERT INTO "${schema}"."posts" (id, tenant_id, challenge_id, author_id, caption, created_at) VALUES ($1, $2, $3, $4, $5, $6::date) ON CONFLICT DO NOTHING`,
      [randomUUID(), row.tenant_id, row.id, row.owner_id, row.description, row.start_date]);
  }
}
