import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { getDb, requireInternal, requireUser, signToken } from '@habitloop/shared';
import { tenants, users } from '../db/schema.js';

const Email = Type.String({ minLength: 3, maxLength: 254, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' });
const Name = Type.String({ minLength: 1, maxLength: 200 });
const Password = Type.String({ minLength: 1, maxLength: 72 });
const Profile = Type.Object({ id: Type.String(), tenant_id: Type.String(), email: Type.String(), name: Type.String(), timezone: Type.String(), created_at: Type.String() });
const AuthResponse = Type.Object({ token: Type.String(), user: Profile });
const Register = Type.Object({ email: Email, password: Password, name: Name, tenant_name: Name, timezone: Type.Optional(Type.String({ maxLength: 100 })) }, { additionalProperties: false });
const Login = Type.Object({ tenant_slug: Type.String({ minLength: 1, maxLength: 200 }), email: Email, password: Type.String() }, { additionalProperties: false });
const Patch = Type.Object({ name: Type.Optional(Name), timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })) }, { additionalProperties: false, minProperties: 0 });

function normalizeEmail(email: string): string { return email.trim().toLowerCase(); }
function slugify(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
function publicProfile(row: typeof users.$inferSelect) {
  return { id: row.id, tenant_id: row.tenant_id, email: row.email, name: row.name, timezone: row.timezone, created_at: row.created_at.toISOString() };
}
async function responseFor(row: typeof users.$inferSelect) {
  return { token: await signToken({ sub: row.id, tenant_id: row.tenant_id, email: row.email, name: row.name }), user: publicProfile(row) };
}
function invalid(message: string): never { const error = new Error(message) as Error & { statusCode: number }; error.statusCode = 422; throw error; }
function validateFields(body: { email?: string; name?: string; tenant_name?: string; password?: string; timezone?: string }): void {
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) invalid('Invalid email');
  if (body.name !== undefined && (!cleanName(body.name) || cleanName(body.name).length > 200)) invalid('Invalid name');
  if (body.tenant_name !== undefined && (!cleanName(body.tenant_name) || !slugify(body.tenant_name))) invalid('Invalid tenant name');
  if (body.password !== undefined && Buffer.byteLength(body.password, 'utf8') > 72) invalid('Invalid password length');
  if (body.timezone !== undefined && !timezoneValid(body.timezone)) invalid('Invalid timezone');
}

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.post('/register', { schema: { body: Register, response: { 201: AuthResponse } } }, async (request, reply) => {
    const body = request.body as Static<typeof Register>;
    validateFields(body);
    const tenantName = cleanName(body.tenant_name);
    const slug = slugify(tenantName);
    const email = normalizeEmail(body.email);
    const db = getDb();
    const tenantId = randomUUID();
    const createdTenant = await db.insert(tenants).values({ id: tenantId, name: tenantName, slug }).onConflictDoNothing({ target: tenants.slug }).returning();
    const tenant = createdTenant[0] ?? (await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1))[0];
    if (!tenant) throw new Error('Unable to resolve tenant');
    const id = randomUUID();
    const hash = await bcrypt.hash(body.password, 10);
    try {
      const inserted = await db.insert(users).values({ id, tenant_id: tenant.id, email, password_hash: hash,
        name: cleanName(body.name), timezone: body.timezone ?? 'UTC', created_at: new Date() }).returning();
      return reply.code(201).send(await responseFor(inserted[0]!));
    } catch (error) {
      if (isUniqueViolation(error)) {
        const conflict = new Error('Email already registered in this tenant') as Error & { statusCode: number };
        conflict.statusCode = 409; throw conflict;
      }
      throw error;
    }
  });

  const dummyHash = await bcrypt.hash(randomUUID(), 10);
  app.post('/login', { schema: { body: Login, response: { 200: AuthResponse, 401: Type.Object({ detail: Type.String() }) } } }, async (request, reply) => {
    const body = request.body as Static<typeof Login>;
    const slug = body.tenant_slug;
    const tenant = (await getDb().select().from(tenants).where(eq(tenants.slug, slug)).limit(1))[0];
    const user = tenant ? (await getDb().select().from(users).where(and(eq(users.tenant_id, tenant.id), eq(users.email, normalizeEmail(body.email)))).limit(1))[0] : undefined;
    const passwordBytes = Buffer.byteLength(body.password, 'utf8');
    const validLength = passwordBytes >= 1 && passwordBytes <= 72;
    const match = await bcrypt.compare(validLength ? body.password : 'invalid', user?.password_hash ?? dummyHash);
    if (!user || !match || !validLength) {
      request.log.warn({ event: 'auth_failed', tenant_slug: slug }, 'auth_failed');
      return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ detail: 'Invalid email or password' });
    }
    return responseFor(user);
  });

  app.get('/me', { preHandler: requireUser, schema: { response: { 200: Profile, 401: Type.Object({ detail: Type.String() }) } } }, async request => {
    const identity = request.user!;
    const row = (await getDb().select().from(users).where(and(eq(users.id, identity.userId), eq(users.tenant_id, identity.tenantId))).limit(1))[0];
    if (!row) { const error = new Error('User not found') as Error & { statusCode: number }; error.statusCode = 404; throw error; }
    return publicProfile(row);
  });

  app.patch('/me', { preHandler: requireUser, schema: { body: Patch, response: { 200: Profile } } }, async request => {
    const identity = request.user!;
    const body = request.body as Static<typeof Patch>;
    if (body.name !== undefined && !cleanName(body.name)) invalid('Invalid name');
    if (body.timezone !== undefined && !timezoneValid(body.timezone)) invalid('Invalid timezone');
    const changes: { name?: string; timezone?: string } = {};
    if (body.name !== undefined) changes.name = cleanName(body.name);
    if (body.timezone !== undefined) changes.timezone = body.timezone;
    const condition = and(eq(users.id, identity.userId), eq(users.tenant_id, identity.tenantId));
    const row = Object.keys(changes).length
      ? (await getDb().update(users).set(changes).where(condition).returning())[0]
      : (await getDb().select().from(users).where(condition).limit(1))[0];
    if (!row) { const error = new Error('User not found') as Error & { statusCode: number }; error.statusCode = 404; throw error; }
    return publicProfile(row);
  });

  app.get('/tenants/:slug', { schema: { params: Type.Object({ slug: Type.String() }) } }, async (request) => {
    const { slug } = request.params as { slug: string };
    const tenant = (await getDb().select({ name: tenants.name }).from(tenants).where(eq(tenants.slug, slug)).limit(1))[0];
    return { exists: !!tenant, name: tenant?.name ?? null };
  });

  app.get('/internal/users', { preHandler: [requireInternal, requireUser], schema: { hide: true, querystring: Type.Object({ email: Email }) } }, async request => {
    const { email } = request.query as { email: string };
    const identity = request.user!;
    const row = (await getDb().select().from(users).where(and(eq(users.tenant_id, identity.tenantId), eq(users.email, normalizeEmail(email)))).limit(1))[0];
    if (!row) { const error = new Error('User not found') as Error & { statusCode: number }; error.statusCode = 404; throw error; }
    return publicProfile(row);
  });

  app.get('/internal/users/:id', { preHandler: [requireInternal, requireUser], schema: { hide: true, params: Type.Object({ id: Type.String({ format: 'uuid' }) }) } }, async request => {
    const { id } = request.params as { id: string };
    const identity = request.user!;
    const row = (await getDb().select().from(users).where(and(eq(users.id, id), eq(users.tenant_id, identity.tenantId))).limit(1))[0];
    if (!row) { const error = new Error('User not found') as Error & { statusCode: number }; error.statusCode = 404; throw error; }
    return publicProfile(row);
  });
}
