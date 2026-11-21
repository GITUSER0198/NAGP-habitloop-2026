import { getConfig, getPool } from '@habitloop/shared';

export async function initializeIntegrationTables(): Promise<void> {
  const schema = getConfig().dbSchema;
  await getPool().query(`CREATE TABLE IF NOT EXISTS "${schema}".links (
    id uuid PRIMARY KEY, tenant_id uuid NOT NULL, user_id uuid NOT NULL, provider varchar(20) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'active', ingest_key_hash varchar(64) NOT NULL,
    activity_map jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
  await getPool().query(`CREATE INDEX IF NOT EXISTS ix_links_tenant ON "${schema}".links (tenant_id, user_id)`);
  await getPool().query(`CREATE TABLE IF NOT EXISTS "${schema}".partner_events (
    id uuid PRIMARY KEY, tenant_id uuid NOT NULL, link_id uuid NOT NULL REFERENCES "${schema}".links(id),
    event_id varchar(255) NOT NULL, payload jsonb NOT NULL, status varchar(20) NOT NULL DEFAULT 'received',
    reason varchar(1000), received_at timestamptz NOT NULL DEFAULT now(), UNIQUE(link_id, event_id))`);
  await getPool().query(`CREATE INDEX IF NOT EXISTS ix_partner_events_link_received ON "${schema}".partner_events (link_id, received_at DESC)`);
}
