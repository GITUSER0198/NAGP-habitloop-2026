import { index, pgSchema, unique } from 'drizzle-orm/pg-core';
import { getConfig } from '@habitloop/shared';

const usersSchema = pgSchema(getConfig().dbSchema);
export const tenants = usersSchema.table('tenants', table => ({
  id: table.uuid('id').primaryKey(),
  name: table.varchar('name', { length: 200 }).notNull(),
  slug: table.varchar('slug', { length: 200 }).notNull().unique()
}));
export const users = usersSchema.table('users', table => ({
  id: table.uuid('id').primaryKey(),
  tenant_id: table.uuid('tenant_id').notNull().references(() => tenants.id),
  email: table.varchar('email', { length: 254 }).notNull(),
  password_hash: table.varchar('password_hash', { length: 60 }).notNull(),
  name: table.varchar('name', { length: 200 }).notNull(),
  timezone: table.varchar('timezone', { length: 100 }).notNull(),
  created_at: table.timestamp('created_at', { withTimezone: true }).notNull()
}), table => [
  unique('uq_users_tenant_email').on(table.tenant_id, table.email),
  index('ix_users_tenant_id').on(table.tenant_id)
]);
