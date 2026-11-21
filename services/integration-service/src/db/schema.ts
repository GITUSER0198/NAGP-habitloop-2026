import { jsonb, pgSchema, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { getConfig } from '@habitloop/shared';

const schema = pgSchema(getConfig().dbSchema);
export const links = schema.table('links', {
  id: uuid('id').primaryKey(), tenant_id: uuid('tenant_id').notNull(), user_id: uuid('user_id').notNull(),
  provider: varchar('provider', { length: 20 }).notNull(), status: varchar('status', { length: 20 }).notNull().default('active'),
  ingest_key_hash: varchar('ingest_key_hash', { length: 64 }).notNull(), activity_map: jsonb('activity_map').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
export const partnerEvents = schema.table('partner_events', {
  id: uuid('id').primaryKey(), tenant_id: uuid('tenant_id').notNull(), link_id: uuid('link_id').notNull(),
  event_id: varchar('event_id', { length: 255 }).notNull(), payload: jsonb('payload').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('received'), reason: varchar('reason', { length: 1000 }),
  received_at: timestamp('received_at', { withTimezone: true }).notNull().defaultNow()
}, table => [unique('uq_partner_events_link_event').on(table.link_id, table.event_id)]);
