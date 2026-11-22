import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { getDb, requireInternal, requireUser, signToken } from '@habitloop/shared';
import { memberships, tenants, users } from '../db/schema.js';
import { emailDomain, joinOrganization } from '../organization.js';

type UserRow = typeof users.$inferSelect;
type TenantRow = typeof tenants.$inferSelect;
type Failure = Error & { statusCode: number };

const Email = Type.String({ minLength: 3, maxLength: 254, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' });
const Name = Type.String({ minLength: 1, maxLength: 200 });
const Password = Type.String({ minLength: 1, maxLength: 72 });
const Detail = Type.Object({ detail: Type.String() });
const Profile = Type.Object({ id: Type.String(), tenant_id: Type.String(), email: Type.String(), name: Type.String(), timezone: Type.String(), created_at: Type.String() });
const CommunityRef = Type.Object({ id: Type.String(), name: Type.String(), kind: Type.String() });
const OrganizationRef = Type.Union([Type.Object({ id: Type.String(), domain: Type.String() }), Type.Null()]);
const ProfileWithCommunity = Type.Composite([Profile, Type.Object({ community: CommunityRef, organization: OrganizationRef })]);
const AuthResponse = Type.Object({ token: Type.String(), user: Profile, community: CommunityRef });
const MyCommunity = Type.Object({ id: Type.String(), name: Type.String(), kind: Type.String(), description: Type.String(), role: Type.String(), member_count: Type.Number(), active: Type.Boolean() });
const DiscoverCommunity = Type.Object({ id: Type.String(), name: Type.String(), description: Type.String(), member_count: Type.Number() });
const Register = Type.Object({ email: Email, password: Password, name: Name, timezone: Type.Optional(Type.String({ maxLength: 100 })) }, { additionalProperties: false });
const Login = Type.Object({ email: Email, password: Type.String() }, { additionalProperties: false });
const Patch = Type.Object({ name: Type.Optional(Name), timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })) }, { additionalProperties: false, minProperties: 0 });
const CreateCommunity = Type.Object({ name: Type.String({ maxLength: 200 }), description: Type.Optional(Type.String({ maxLength: 2000 })) }, { additionalProperties: false });
const CommunityParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const Switch = Type.Object({ community_id: Type.String({ format: 'uuid' }) }, { additionalProperties: false });

const COMMUNITY_NAME_MIN = 3;
const COMMUNITY_NAME_MAX = 60;
const DESCRIPTION_MAX = 500;

function normalizeEmail(email: string): string { return email.trim().toLowerCase(); }
function slugify(value: string): string {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function timezoneValid(value: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
}
function cleanName(value: string): string { return value.trim(); }
function isUniqueViolation(value: unknown): boolean {
  let current = value;
  while (current && typeof current === 'object') {
    if ((current as { code?: string }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
function fail(statusCode: number, message: string): never {
  const error = new Error(message) as Failure; error.statusCode = statusCode; throw error;
}
function invalid(message: string): never { return fail(422, message); }
function publicProfile(row: UserRow, tenantId: string) {
  return { id: row.id, tenant_id: tenantId, email: row.email, name: row.name, timezone: row.timezone, created_at: row.created_at.toISOString() };
}
function communityRef(tenant: TenantRow) { return { id: tenant.id, name: tenant.name, kind: tenant.kind }; }
async function organizationOf(row: UserRow): Promise<{ id: string; domain: string } | null> {
  const org = row.organization_id ? await findTenant(row.organization_id) : undefined;
  return org ? { id: org.id, domain: org.slug } : null;
}
async function authFor(row: UserRow, tenant: TenantRow) {
  const token = await signToken({ sub: row.id, tenant_id: tenant.id, email: row.email, name: row.name });
  return { token, user: publicProfile(row, tenant.id), community: communityRef(tenant) };
}
function validateFields(body: { email?: string; name?: string; password?: string; timezone?: string }): void {
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) invalid('Invalid email');
  if (body.name !== undefined && (!cleanName(body.name) || cleanName(body.name).length > 200)) invalid('Invalid name');
  if (body.password !== undefined && Buffer.byteLength(body.password, 'utf8') > 72) invalid('Invalid password length');
  if (body.timezone !== undefined && !timezoneValid(body.timezone)) invalid('Invalid timezone');
}

async function findMembership(userId: string, tenantId: string) {
  return (await getDb().select().from(memberships).where(and(eq(memberships.user_id, userId), eq(memberships.tenant_id, tenantId))).limit(1))[0];
}
async function findTenant(id: string): Promise<TenantRow | undefined> {
  return (await getDb().select().from(tenants).where(eq(tenants.id, id)).limit(1))[0];
}
async function findPersonal(userId: string): Promise<TenantRow> {
  const row = (await getDb().select().from(tenants).where(and(eq(tenants.owner_id, userId), eq(tenants.kind, 'personal'))).limit(1))[0];
  if (!row) throw new Error('Personal space missing');
  return row;
}
async function memberCounts(tenantIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (tenantIds.length === 0) return counts;
  const rows = await getDb().select({ tenant_id: memberships.tenant_id, total: sql<string>`count(*)` }).from(memberships)
    .where(inArray(memberships.tenant_id, tenantIds)).groupBy(memberships.tenant_id);
  for (const row of rows) counts.set(row.tenant_id, Number(row.total));
  return counts;
}
async function loadUser(id: string): Promise<UserRow> {
  const row = (await getDb().select().from(users).where(eq(users.id, id)).limit(1))[0];
  if (!row) fail(404, 'User not found');
  return row;
}
// The active community of a token must still be one the user belongs to.
async function requireActiveMember(userId: string, tenantId: string): Promise<UserRow> {
  const row = (await getDb().select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!row || !(await findMembership(userId, tenantId))) fail(404, 'User not found');
  return row;
}
async function setLastTenant(userId: string, tenantId: string): Promise<void> {
  await getDb().update(users).set({ last_tenant_id: tenantId }).where(eq(users.id, userId));
}

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.post('/register', { schema: { body: Register, response: { 201: AuthResponse, 409: Detail } } }, async (request, reply) => {
    const body = request.body as Static<typeof Register>;
    validateFields(body);
    const email = normalizeEmail(body.email);
    const db = getDb();
    const existing = (await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1))[0];
    if (existing) fail(409, 'An account with this email already exists');
    const id = randomUUID();
    const personalId = randomUUID();
    const now = new Date();
    const hash = await bcrypt.hash(body.password, 10);
    try {
      const inserted = (await db.insert(users).values({ id, email, password_hash: hash, name: cleanName(body.name),
        timezone: body.timezone ?? 'UTC', last_tenant_id: personalId, created_at: now }).returning())[0]!;
      const personal = (await db.insert(tenants).values({ id: personalId, name: 'Personal space', slug: `personal-${id}`,
        kind: 'personal', description: '', owner_id: id, created_at: now }).returning())[0]!;
      await db.insert(memberships).values({ user_id: id, tenant_id: personalId, role: 'owner', joined_at: now });
      // A non-public email domain joins (or creates) the organization for that domain.
      await joinOrganization(id, email);
      return reply.code(201).send(await authFor(inserted, personal));
    } catch (error) {
      if (isUniqueViolation(error)) fail(409, 'An account with this email already exists');
      throw error;
    }
  });

  const dummyHash = await bcrypt.hash(randomUUID(), 10);
  app.post('/login', { schema: { body: Login, response: { 200: AuthResponse, 401: Detail } } }, async (request, reply) => {
    const body = request.body as Static<typeof Login>;
    const user = (await getDb().select().from(users).where(eq(users.email, normalizeEmail(body.email))).limit(1))[0];
    const passwordBytes = Buffer.byteLength(body.password, 'utf8');
    const validLength = passwordBytes >= 1 && passwordBytes <= 72;
    const match = await bcrypt.compare(validLength ? body.password : 'invalid', user?.password_hash ?? dummyHash);
    if (!user || !match || !validLength) {
      request.log.warn({ event: 'auth_failed' }, 'auth_failed');
      return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ detail: 'Invalid email or password' });
    }
    // Land in the last active community; fall back to the Personal space if it was left.
    let tenant: TenantRow | undefined;
    if (user.last_tenant_id && await findMembership(user.id, user.last_tenant_id)) tenant = await findTenant(user.last_tenant_id);
    tenant ??= await findPersonal(user.id);
    return authFor(user, tenant);
  });

  app.get('/me', { preHandler: requireUser, schema: { response: { 200: ProfileWithCommunity, 401: Detail } } }, async request => {
    const identity = request.user!;
    const row = await requireActiveMember(identity.userId, identity.tenantId);
    const tenant = await findTenant(identity.tenantId);
    if (!tenant) fail(404, 'User not found');
    return { ...publicProfile(row, tenant.id), community: communityRef(tenant), organization: await organizationOf(row) };
  });

  app.patch('/me', { preHandler: requireUser, schema: { body: Patch, response: { 200: ProfileWithCommunity } } }, async request => {
    const identity = request.user!;
    const body = request.body as Static<typeof Patch>;
    if (body.name !== undefined && !cleanName(body.name)) invalid('Invalid name');
    if (body.timezone !== undefined && !timezoneValid(body.timezone)) invalid('Invalid timezone');
    const current = await requireActiveMember(identity.userId, identity.tenantId);
    const changes: { name?: string; timezone?: string } = {};
    if (body.name !== undefined) changes.name = cleanName(body.name);
    if (body.timezone !== undefined) changes.timezone = body.timezone;
    const row = Object.keys(changes).length
      ? (await getDb().update(users).set(changes).where(eq(users.id, identity.userId)).returning())[0] ?? current
      : current;
    const tenant = await findTenant(identity.tenantId);
    if (!tenant) fail(404, 'User not found');
    return { ...publicProfile(row, tenant.id), community: communityRef(tenant), organization: await organizationOf(row) };
  });

  app.get('/communities', { preHandler: requireUser, schema: { response: { 200: Type.Array(MyCommunity) } } }, async request => {
    const identity = request.user!;
    const rows = await getDb().select({ tenant: tenants, role: memberships.role }).from(memberships)
      .innerJoin(tenants, eq(memberships.tenant_id, tenants.id)).where(eq(memberships.user_id, identity.userId))
      .orderBy(asc(memberships.joined_at));
    const counts = await memberCounts(rows.map(row => row.tenant.id));
    const mapped = rows.map(row => ({ id: row.tenant.id, name: row.tenant.name, kind: row.tenant.kind, description: row.tenant.description,
      role: row.role, member_count: counts.get(row.tenant.id) ?? 0, active: row.tenant.id === identity.tenantId }));
    return ['personal', 'organization', 'community'].flatMap(kind => mapped.filter(item => item.kind === kind));
  });

  app.get('/communities/discover', { preHandler: requireUser, schema: { querystring: Type.Object({ q: Type.Optional(Type.String({ maxLength: 100 })) }), response: { 200: Type.Array(DiscoverCommunity) } } }, async request => {
    const identity = request.user!;
    const { q } = request.query as { q?: string };
    const mine = (await getDb().select({ id: memberships.tenant_id }).from(memberships).where(eq(memberships.user_id, identity.userId))).map(row => row.id);
    const conditions = [eq(tenants.kind, 'community')];
    if (mine.length > 0) conditions.push(notInArray(tenants.id, mine));
    const term = q?.trim().toLowerCase();
    if (term) {
      const escaped = term.replace(/[\\%_]/g, match => '\\' + match);
      conditions.push(sql`lower(${tenants.name}) like ${'%' + escaped + '%'}`);
    }
    const rows = await getDb().select().from(tenants).where(and(...conditions)).orderBy(asc(tenants.name)).limit(50);
    const counts = await memberCounts(rows.map(row => row.id));
    return rows.map(row => ({ id: row.id, name: row.name, description: row.description, member_count: counts.get(row.id) ?? 0 }));
  });

  app.post('/communities', { preHandler: requireUser, schema: { body: CreateCommunity, response: { 201: AuthResponse, 409: Detail } } }, async (request, reply) => {
    const identity = request.user!;
    const body = request.body as Static<typeof CreateCommunity>;
    const name = cleanName(body.name);
    if (name.length < COMMUNITY_NAME_MIN || name.length > COMMUNITY_NAME_MAX) invalid(`Community name must be ${COMMUNITY_NAME_MIN} to ${COMMUNITY_NAME_MAX} characters`);
    const slug = slugify(name);
    if (!slug) invalid('Community name must contain letters or numbers');
    const description = cleanName(body.description ?? '');
    if (description.length > DESCRIPTION_MAX) invalid(`Description must be at most ${DESCRIPTION_MAX} characters`);
    const user = await loadUser(identity.userId);
    const db = getDb();
    const taken = (await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1))[0];
    if (taken) fail(409, 'A community with this name already exists');
    const now = new Date();
    try {
      const tenant = (await db.insert(tenants).values({ id: randomUUID(), name, slug, kind: 'community', description, owner_id: user.id, created_at: now }).returning())[0]!;
      await db.insert(memberships).values({ user_id: user.id, tenant_id: tenant.id, role: 'owner', joined_at: now });
      await setLastTenant(user.id, tenant.id);
      return reply.code(201).send(await authFor(user, tenant));
    } catch (error) {
      if (isUniqueViolation(error)) fail(409, 'A community with this name already exists');
      throw error;
    }
  });

  app.post('/communities/:id/join', { preHandler: requireUser, schema: { params: CommunityParams, response: { 200: AuthResponse, 404: Detail } } }, async request => {
    const identity = request.user!;
    const { id } = request.params as Static<typeof CommunityParams>;
    const tenant = await findTenant(id);
    if (!tenant || tenant.kind !== 'community') fail(404, 'Community not found');
    const user = await loadUser(identity.userId);
    if (!(await findMembership(user.id, tenant.id))) {
      try { await getDb().insert(memberships).values({ user_id: user.id, tenant_id: tenant.id, role: 'member', joined_at: new Date() }); }
      catch (error) { if (!isUniqueViolation(error)) throw error; }
    }
    await setLastTenant(user.id, tenant.id);
    return authFor(user, tenant);
  });

  app.post('/communities/:id/leave', { preHandler: requireUser, schema: { params: CommunityParams, response: { 200: AuthResponse, 404: Detail, 409: Detail } } }, async request => {
    const identity = request.user!;
    const { id } = request.params as Static<typeof CommunityParams>;
    const tenant = await findTenant(id);
    const membership = tenant ? await findMembership(identity.userId, id) : undefined;
    if (!tenant || !membership) fail(404, 'Community not found');
    if (tenant.kind === 'personal') fail(409, 'You cannot leave your Personal space');
    if (tenant.kind === 'organization') fail(409, 'You cannot leave your organization');
    if (membership.role === 'owner') {
      const owners = await getDb().select({ id: memberships.user_id }).from(memberships).where(and(eq(memberships.tenant_id, id), eq(memberships.role, 'owner')));
      if (owners.length <= 1) fail(409, 'You are the only owner of this community, so you cannot leave it');
    }
    await getDb().delete(memberships).where(and(eq(memberships.user_id, identity.userId), eq(memberships.tenant_id, id)));
    const user = await loadUser(identity.userId);
    // Leaving the active community drops back to the Personal space; leaving another keeps the active one.
    const personal = await findPersonal(user.id);
    const active = identity.tenantId !== id ? await findTenant(identity.tenantId) : undefined;
    const target = active && await findMembership(user.id, active.id) ? active : personal;
    if (user.last_tenant_id === id || target.id !== user.last_tenant_id) await setLastTenant(user.id, target.id);
    return authFor(user, target);
  });

  // Owners can delete a community they created. Members fall back to their Personal space on next
  // login; rows other services keep for this community become unreachable because no one can switch to it.
  app.delete('/communities/:id', { preHandler: requireUser, schema: { params: CommunityParams, response: { 200: AuthResponse, 403: Detail, 404: Detail, 409: Detail } } }, async request => {
    const identity = request.user!;
    const { id } = request.params as Static<typeof CommunityParams>;
    const tenant = await findTenant(id);
    const membership = tenant ? await findMembership(identity.userId, id) : undefined;
    if (!tenant || !membership) fail(404, 'Community not found');
    if (tenant.kind === 'personal') fail(409, 'You cannot delete your Personal space');
    if (tenant.kind === 'organization') fail(409, 'You cannot delete your organization');
    if (membership.role !== 'owner') fail(403, 'Only an owner can delete this community');
    await getDb().update(users).set({ last_tenant_id: null }).where(eq(users.last_tenant_id, id));
    await getDb().delete(memberships).where(eq(memberships.tenant_id, id));
    await getDb().delete(tenants).where(eq(tenants.id, id));
    const user = await loadUser(identity.userId);
    const personal = await findPersonal(user.id);
    await setLastTenant(user.id, personal.id);
    return authFor(user, personal);
  });

  app.post('/switch', { preHandler: requireUser, schema: { body: Switch, response: { 200: AuthResponse, 403: Detail } } }, async request => {
    const identity = request.user!;
    const body = request.body as Static<typeof Switch>;
    const tenant = await findTenant(body.community_id);
    if (!tenant || !(await findMembership(identity.userId, tenant.id))) fail(403, 'You are not a member of this community');
    const user = await loadUser(identity.userId);
    if (tenant.kind === 'organization' && tenant.slug !== emailDomain(user.email)) fail(403, 'You are not a member of this community');
    await setLastTenant(user.id, tenant.id);
    return authFor(user, tenant);
  });

  // Internal lookups: only members of the community the caller is working in resolve.
  app.get('/internal/users', { preHandler: [requireInternal, requireUser], schema: { hide: true, querystring: Type.Object({ email: Email, tenant_id: Type.String({ format: 'uuid' }) }) } }, async request => {
    const { email, tenant_id } = request.query as { email: string; tenant_id: string };
    const row = (await getDb().select().from(users).where(eq(users.email, normalizeEmail(email))).limit(1))[0];
    if (!row || !(await findMembership(row.id, tenant_id))) fail(404, 'User not found');
    return publicProfile(row, tenant_id);
  });

  app.get('/internal/users/:id', { preHandler: [requireInternal, requireUser], schema: { hide: true, params: Type.Object({ id: Type.String({ format: 'uuid' }) }) } }, async request => {
    const { id } = request.params as { id: string };
    const identity = request.user!;
    const row = (await getDb().select().from(users).where(eq(users.id, id)).limit(1))[0];
    if (!row || !(await findMembership(row.id, identity.tenantId))) fail(404, 'User not found');
    return publicProfile(row, identity.tenantId);
  });
}
