import { date, foreignKey, index, integer, pgSchema, primaryKey, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { getConfig } from '@habitloop/shared';

const schema = pgSchema(getConfig().dbSchema);
export const challenges = schema.table('challenges', {
  id: uuid('id').primaryKey(), tenant_id: uuid('tenant_id').notNull(), owner_id: uuid('owner_id').notNull(),
  title: varchar('title', { length: 200 }).notNull(), description: text('description').notNull().default(''),
  visibility: varchar('visibility', { length: 7 }).notNull(), invite_code: varchar('invite_code', { length: 8 }).notNull(),
  activity_category: varchar('activity_category', { length: 100 }).notNull(), start_date: date('start_date', { mode: 'string' }).notNull(),
  end_date: date('end_date', { mode: 'string' }).notNull(), target_count: integer('target_count').notNull()
}, table => [unique('uq_challenges_tenant_id').on(table.tenant_id, table.id), unique('uq_challenges_tenant_code').on(table.tenant_id, table.invite_code), index('ix_challenges_tenant').on(table.tenant_id)]);
export const participants = schema.table('participants', {
  challenge_id: uuid('challenge_id').notNull(), user_id: uuid('user_id').notNull(), tenant_id: uuid('tenant_id').notNull(),
  status: varchar('status', { length: 8 }).notNull(), joined_at: timestamp('joined_at', { withTimezone: true })
}, table => [primaryKey({ name: 'pk_participants', columns: [table.challenge_id, table.user_id, table.tenant_id] }),
  foreignKey({ name: 'fk_participant_challenge_tenant', columns: [table.tenant_id, table.challenge_id], foreignColumns: [challenges.tenant_id, challenges.id] }),
  index('ix_participants_user').on(table.tenant_id, table.user_id, table.status)]);
