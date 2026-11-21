import { index, jsonb, pgSchema, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { getConfig } from '@habitloop/shared';

export type ScheduleValue = Record<string, string | number>;
const schema = pgSchema(getConfig().dbSchema);
export const recommendations = schema.table('recommendations', {
  id: uuid('id').primaryKey(), tenant_id: uuid('tenant_id').notNull(), user_id: uuid('user_id').notNull(), activity_id: uuid('activity_id').notNull(),
  kind: varchar('kind', { length: 10 }).notNull(), current_value: jsonb('current_value').$type<ScheduleValue>().notNull(),
  suggested_value: jsonb('suggested_value').$type<ScheduleValue>().notNull(), reason: varchar('reason', { length: 1000 }).notNull(),
  confidence: varchar('confidence', { length: 6 }).notNull(), status: varchar('status', { length: 9 }).notNull().default('pending'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull()
}, table => [
  index('ix_recommendations_tenant_id').on(table.tenant_id), index('ix_recommendations_user_id').on(table.user_id),
  uniqueIndex('uq_pending_recommendation_values').on(table.tenant_id, table.user_id, table.activity_id, table.kind, table.current_value, table.suggested_value).where(sql`status = 'pending'`)
]);
