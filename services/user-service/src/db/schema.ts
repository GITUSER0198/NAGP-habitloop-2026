import { index, pgSchema, unique } from 'drizzle-orm/pg-core';
import { getConfig } from '@habitloop/shared';

const usersSchema = pgSchema(getConfig().dbSchema);
// Tenant ids isolate data. kind 'community' is a shared group; 'personal' is the private per-user space, never listed; 'organization' is the email domain, never listed.
export const tenants = usersSchema.table('tenants', table => ({
  id: table.uuid('id').primaryKey(),
  name: table.varchar('name', { length: 200 }).notNull(),
  slug: table.varchar('slug', { length: 200 }).notNull().unique(),
  kind: table.varchar('kind', { length: 20 }).notNull(),
  description: table.varchar('description', { length: 500 }).notNull(),
  owner_id: table.uuid('owner_id'),
  created_at: table.timestamp('created_at', { withTimezone: true }).notNull()
}));
export const users = usersSchema.table('users', table => ({
  id: table.uuid('id').primaryKey(),
  email: table.varchar('email', { length: 254 }).notNull().unique(),
  password_hash: table.varchar('password_hash', { length: 60 }).notNull(),
  name: table.varchar('name', { length: 200 }).notNull(),
  timezone: table.varchar('timezone', { length: 100 }).notNull(),
  last_tenant_id: table.uuid('last_tenant_id'),
  organization_id: table.uuid('organization_id'),
  created_at: table.timestamp('created_at', { withTimezone: true }).notNull()
}));
export const memberships = usersSchema.table('memberships', table => ({
  user_id: table.uuid('user_id').notNull().references(() => users.id),
  tenant_id: table.uuid('tenant_id').notNull().references(() => tenants.id),
  role: table.varchar('role', { length: 20 }).notNull(),
  joined_at: table.timestamp('joined_at', { withTimezone: true }).notNull()
}), table => [
  unique('uq_memberships_user_tenant').on(table.user_id, table.tenant_id),
  index('ix_memberships_tenant_id').on(table.tenant_id)
]);
