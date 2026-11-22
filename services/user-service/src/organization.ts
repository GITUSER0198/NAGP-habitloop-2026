import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@habitloop/shared';
import { memberships, tenants, users } from './db/schema.js';

// Public mail providers never form an organization: those users stay on their Personal space only.
export const PUBLIC_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'proton.me', 'protonmail.com'
]);

/** The lower-case domain of an email address, or '' when there is none. */
export function emailDomain(email: string): string {
  const at = email.trim().toLowerCase().lastIndexOf('@');
  return at < 0 ? '' : email.trim().toLowerCase().slice(at + 1);
}
export function isPublicDomain(domain: string): boolean { return PUBLIC_DOMAINS.has(domain); }

/**
 * Join (creating it if missing) the organization tenant for the user's email domain.
 * The first user of a domain becomes its owner. Returns the organization id, or null for public domains.
 */
export async function joinOrganization(userId: string, email: string): Promise<string | null> {
  const domain = emailDomain(email);
  if (!domain || isPublicDomain(domain)) return null;
  const db = getDb();
  const now = new Date();
  let org = (await db.select().from(tenants).where(and(eq(tenants.slug, domain), eq(tenants.kind, 'organization'))).limit(1))[0];
  let role = 'member';
  if (!org) {
    org = (await db.insert(tenants).values({ id: randomUUID(), name: domain, slug: domain, kind: 'organization',
      description: '', owner_id: userId, created_at: now }).onConflictDoNothing().returning())[0];
    if (org) role = 'owner';
    else org = (await db.select().from(tenants).where(eq(tenants.slug, domain)).limit(1))[0];
  }
  if (!org) throw new Error('Organization could not be created');
  await db.insert(memberships).values({ user_id: userId, tenant_id: org.id, role, joined_at: now }).onConflictDoNothing();
  await db.update(users).set({ organization_id: org.id }).where(eq(users.id, userId));
  return org.id;
}

/** Boot migration: accounts created before organizations existed join the organization of their domain. */
export async function backfillOrganizations(): Promise<void> {
  const rows = await getDb().select({ id: users.id, email: users.email }).from(users).where(isNull(users.organization_id));
  for (const row of rows) await joinOrganization(row.id, row.email);
}
