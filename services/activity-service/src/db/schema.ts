import { index, integer, jsonb, pgSchema, timestamp, unique, uuid, varchar, boolean } from 'drizzle-orm/pg-core';
import { getConfig } from '@habitloop/shared';

const schema = pgSchema(getConfig().dbSchema);
export const activities = schema.table('activities', {
  id: uuid('id').primaryKey(), tenant_id: uuid('tenant_id').notNull(), user_id: uuid('user_id').notNull(),
  name: varchar('name', { length: 200 }).notNull(), category: varchar('category', { length: 100 }).notNull(),
  frequency: varchar('frequency', { length: 10 }).notNull(), days_of_week: integer('days_of_week').array().notNull(),
  preferred_time: varchar('preferred_time', { length: 5 }).notNull(), target_per_week: integer('target_per_week').notNull(),
  active: boolean('active').notNull().default(true)
}, table => [index('ix_activities_tenant').on(table.tenant_id), index('ix_activities_user').on(table.user_id)]);
export const activityLogs = schema.table('activity_logs', {
  id: uuid('id').primaryKey(), tenant_id: uuid('tenant_id').notNull(), user_id: uuid('user_id').notNull(),
  activity_id: uuid('activity_id').notNull().references(() => activities.id), status: varchar('status', { length: 10 }).notNull(),
  logged_at: timestamp('logged_at', { withTimezone: true }).notNull(), source: varchar('source', { length: 10 }).notNull(),
  source_event_id: varchar('source_event_id', { length: 255 }), duration_min: integer('duration_min'), metadata: jsonb('metadata').notNull().default({})
}, table => [unique('uq_activity_logs_source_event').on(table.source_event_id), index('ix_activity_logs_tenant').on(table.tenant_id), index('ix_activity_logs_activity').on(table.activity_id), index('ix_activity_logs_logged_at').on(table.logged_at)]);
