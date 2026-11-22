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
export const posts = schema.table('posts', {
  id: uuid('id').primaryKey(), tenant_id: uuid('tenant_id').notNull(), challenge_id: uuid('challenge_id').notNull(), author_id: uuid('author_id').notNull(),
  caption: text('caption').notNull().default(''), image_url: text('image_url'), caring_value: varchar('caring_value', { length: 100 }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [unique('uq_posts_challenge').on(table.challenge_id), index('ix_posts_tenant_created').on(table.tenant_id, table.created_at)]);
export const postLikes = schema.table('post_likes', {
  post_id: uuid('post_id').notNull(), user_id: uuid('user_id').notNull(), tenant_id: uuid('tenant_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [unique('uq_post_likes').on(table.post_id, table.user_id), index('ix_post_likes_post').on(table.post_id)]);
export const postComments = schema.table('post_comments', {
  id: uuid('id').primaryKey(), post_id: uuid('post_id').notNull(), tenant_id: uuid('tenant_id').notNull(), author_id: uuid('author_id').notNull(),
  body: varchar('body', { length: 1000 }).notNull(), created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [index('ix_post_comments_post').on(table.post_id, table.created_at)]);
