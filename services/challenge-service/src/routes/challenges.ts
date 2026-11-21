import { randomBytes, randomUUID } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, inArray, lte, gte, or } from 'drizzle-orm';
import { getConfig, getDb, invalidInput, requireInternal, requireUser } from '@habitloop/shared';
import { challenges, participants } from '../db/schema.js';

const Uuid = Type.String({ format: 'uuid' });
const Email = Type.String({ minLength: 3, maxLength: 254, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' });
const Create = Type.Object({ title: Type.String({ minLength: 1, maxLength: 200 }), description: Type.Optional(Type.String({ maxLength: 10000 })),
  visibility: Type.Optional(Type.Union([Type.Literal('public'), Type.Literal('private')])), activity_category: Type.String({ minLength: 1, maxLength: 100 }),
  start_date: Type.String({ format: 'date' }), end_date: Type.String({ format: 'date' }), target_count: Type.Integer({ minimum: 1 }) }, { additionalProperties: false });
const Invite = Type.Object({ user_ids: Type.Optional(Type.Array(Uuid)), emails: Type.Optional(Type.Array(Email)) }, { additionalProperties: false });
const JoinCode = Type.Object({ invite_code: Type.String({ pattern: '^[A-Z0-9]{8}$' }) }, { additionalProperties: false });
type Identity = { userId: string; tenantId: string };
function fail(statusCode: number, message: string): never { throw Object.assign(new Error(message), { statusCode }); }
function today(): string { return new Date().toISOString().slice(0, 10); }
function code(): string { return randomBytes(6).toString('base64url').replace(/[-_]/g, 'A').slice(0, 8).toUpperCase(); }
function headers(request: FastifyRequest): Record<string, string> { return { 'x-internal-token': getConfig().internalToken, ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}) }; }
function idn(request: FastifyRequest): Identity { return request.user!; }
async function getChallenge(id: string, identity: Identity) {
  const row = (await getDb().select().from(challenges).where(and(eq(challenges.id, id), eq(challenges.tenant_id, identity.tenantId))).limit(1))[0];
  if (!row) fail(404, 'Challenge not found'); return row;
}
async function participant(challenge: typeof challenges.$inferSelect, userId: string) {
  return (await getDb().select().from(participants).where(and(eq(participants.tenant_id, challenge.tenant_id), eq(participants.challenge_id, challenge.id), eq(participants.user_id, userId))).limit(1))[0];
}
async function visible(challenge: typeof challenges.$inferSelect, identity: Identity): Promise<void> {
  if (challenge.visibility === 'public' || challenge.owner_id === identity.userId) return;
  const member = await participant(challenge, identity.userId);
  if (!member || !['invited', 'joined'].includes(member.status)) fail(404, 'Challenge not found');
}
function open(challenge: typeof challenges.$inferSelect): void {
  const end = new Date(challenge.end_date).toISOString().slice(0, 10);
  if (end < today()) fail(409, 'Challenge has ended');
}
async function join(challenge: typeof challenges.$inferSelect, userId: string) {
  open(challenge);
  const existing = await participant(challenge, userId);
  if (!existing) return (await getDb().insert(participants).values({ tenant_id: challenge.tenant_id, challenge_id: challenge.id, user_id: userId, status: 'joined', joined_at: new Date() }).returning())[0]!;
  if (existing.status === 'joined') return existing;
  return (await getDb().update(participants).set({ status: 'joined', joined_at: new Date() }).where(and(eq(participants.tenant_id, challenge.tenant_id), eq(participants.challenge_id, challenge.id), eq(participants.user_id, userId))).returning())[0]!;
}
async function userLookup(request: FastifyRequest, endpoint: string): Promise<Response> {
  try { return await fetch(`${process.env.USER_SERVICE_URL ?? 'http://user-service:47820'}${endpoint}`, { headers: headers(request), signal: AbortSignal.timeout(3000) }); }
  catch { fail(503, 'Invite recipients could not be verified'); }
}
async function validateUsers(ids: string[], request: FastifyRequest): Promise<void> {
  for (const id of ids) { const response = await userLookup(request, `/api/users/internal/users/${id}`); if (response.status === 404) fail(404, 'Invite recipient not found'); if (!response.ok) fail(503, 'Invite recipients could not be verified'); }
}
async function resolveEmails(emails: string[], request: FastifyRequest): Promise<string[]> {
  const ids: string[] = [];
  for (const email of emails) {
    const response = await userLookup(request, `/api/users/internal/users?email=${encodeURIComponent(email)}&tenant_id=${encodeURIComponent(request.user!.tenantId)}`);
    if (response.status === 404) fail(422, `${email} is not a member of this community, so they cannot be invited`);
    if (!response.ok) fail(503, 'Invite recipients could not be verified');
    try { const value = await response.json() as { id?: unknown }; if (typeof value?.id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id)) throw new Error('Invalid user id'); ids.push(value.id.toLowerCase()); } catch { fail(503, 'Invite recipients could not be verified'); }
  }
  return ids;
}
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function publicChallenge(row: typeof challenges.$inferSelect) {
  const { invite_code, ...response } = row;
  return response;
}

export async function registerChallengeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preValidation', async request => {
    const body = request.body as Record<string, unknown> | null;
    if (body && typeof body === 'object') {
      for (const field of ['title', 'activity_category', 'invite_code']) if (typeof body[field] === 'string') body[field] = body[field].trim();
      if (Array.isArray(body.emails)) body.emails = body.emails.map(value => typeof value === 'string' ? value.trim() : value);
      if (Array.isArray(body.user_ids)) body.user_ids = body.user_ids.map(value => typeof value === 'string' ? value.toLowerCase() : value);
    }
  });
  app.post('/', { onRequest: requireUser, schema: { body: Create } }, async (request, reply) => {
    const body = request.body as Static<typeof Create>;
    const title = body.title.trim(); const category = body.activity_category.trim();
    if (!title || !category || body.end_date < body.start_date) invalidInput('end_date must be on or after start_date', body);
    for (let attempt = 0; attempt < 5; attempt++) {
      const invite_code = code();
      try {
        const created = (await getDb().insert(challenges).values({ id: randomUUID(), tenant_id: idn(request).tenantId, owner_id: idn(request).userId,
          title, description: body.description ?? '', visibility: body.visibility ?? 'public', invite_code, activity_category: category,
          start_date: body.start_date, end_date: body.end_date, target_count: body.target_count }).returning())[0]!;
        await getDb().insert(participants).values({ tenant_id: created.tenant_id, challenge_id: created.id, user_id: created.owner_id, status: 'joined', joined_at: new Date() });
        return reply.code(201).send(created);
      } catch (error) { if ((error as { cause?: { code?: string } }).cause?.code !== '23505' && (error as { code?: string }).code !== '23505') throw error; }
    }
    fail(503, 'Could not allocate an invite code. Try again');
  });
  app.get('/feed', { onRequest: requireUser }, async request => {
    const identity = idn(request);
    const memberIds = getDb().select({ challenge_id: participants.challenge_id }).from(participants).where(and(eq(participants.tenant_id, identity.tenantId), eq(participants.user_id, identity.userId), inArray(participants.status, ['invited', 'joined'])));
    const rows = await getDb().select().from(challenges).where(and(eq(challenges.tenant_id, identity.tenantId), or(eq(challenges.visibility, 'public'), eq(challenges.owner_id, identity.userId), inArray(challenges.id, memberIds)))).orderBy(desc(challenges.start_date), asc(challenges.id));
    return rows.map(publicChallenge);
  });
  app.get('/invites', { onRequest: requireUser }, async request => {
    const identity = idn(request);
    return getDb().select({ id: challenges.id, tenant_id: challenges.tenant_id, owner_id: challenges.owner_id, title: challenges.title, description: challenges.description,
      visibility: challenges.visibility, activity_category: challenges.activity_category, start_date: challenges.start_date, end_date: challenges.end_date, target_count: challenges.target_count })
      .from(challenges).innerJoin(participants, and(eq(participants.tenant_id, challenges.tenant_id), eq(participants.challenge_id, challenges.id)))
      .where(and(eq(challenges.tenant_id, identity.tenantId), eq(participants.user_id, identity.userId), eq(participants.status, 'invited'))).orderBy(desc(challenges.start_date), asc(challenges.id));
  });
  app.post('/join-by-code', { onRequest: requireUser, schema: { body: JoinCode } }, async request => {
    const { invite_code } = request.body as Static<typeof JoinCode>;
    const challenge = (await getDb().select().from(challenges).where(and(eq(challenges.tenant_id, idn(request).tenantId), eq(challenges.invite_code, invite_code))).limit(1))[0];
    if (!challenge) fail(404, 'Challenge not found'); return join(challenge, idn(request).userId);
  });
  app.get('/internal/users/:uid/active', { onRequest: [requireInternal, requireUser], schema: { hide: true, params: Type.Object({ uid: Uuid }), querystring: Type.Object({ category: Type.Optional(Type.String()) }) } }, async request => {
    const { uid } = request.params as { uid: string }; const query = request.query as { category?: string };
    const where = [eq(challenges.tenant_id, idn(request).tenantId), eq(participants.tenant_id, idn(request).tenantId), eq(participants.user_id, uid), eq(participants.status, 'joined'), lte(challenges.start_date, today()), gte(challenges.end_date, today())];
    if (query.category !== undefined) where.push(eq(challenges.activity_category, query.category));
    const rows = await getDb().select({ id: challenges.id }).from(challenges).innerJoin(participants, and(eq(participants.challenge_id, challenges.id), eq(participants.tenant_id, challenges.tenant_id))).where(and(...where)).orderBy(asc(challenges.id));
    return rows.map(row => row.id);
  });
  app.post('/invites/:challenge_id/accept', { onRequest: requireUser, schema: { params: Type.Object({ challenge_id: Uuid }) } }, async request => {
    const challenge = await getChallenge((request.params as { challenge_id: string }).challenge_id, idn(request));
    const member = await participant(challenge, idn(request).userId);
    if (!member || !['invited', 'joined'].includes(member.status)) fail(404, 'Pending invite not found');
    if (member.status === 'joined') return member;
    return join(challenge, idn(request).userId);
  });
  app.post('/invites/:challenge_id/decline', { onRequest: requireUser, schema: { params: Type.Object({ challenge_id: Uuid }) } }, async request => {
    const challenge = await getChallenge((request.params as { challenge_id: string }).challenge_id, idn(request));
    const member = await participant(challenge, idn(request).userId);
    if (!member || member.status === 'left') fail(404, 'Pending invite not found');
    if (member.status === 'joined') fail(409, 'Leave the challenge to end participation');
    return (await getDb().update(participants).set({ status: 'declined' }).where(and(eq(participants.tenant_id, challenge.tenant_id), eq(participants.challenge_id, challenge.id), eq(participants.user_id, idn(request).userId))).returning())[0];
  });
  app.get('/:id', { onRequest: requireUser, schema: { params: Type.Object({ id: Uuid }) } }, async request => { const challenge = await getChallenge((request.params as { id: string }).id, idn(request)); await visible(challenge, idn(request)); return publicChallenge(challenge); });
  app.post('/:id/join', { onRequest: requireUser, schema: { params: Type.Object({ id: Uuid }) } }, async request => {
    const challenge = await getChallenge((request.params as { id: string }).id, idn(request)); await visible(challenge, idn(request));
    if (challenge.visibility !== 'public') fail(409, 'Private challenges require an invite or code'); return join(challenge, idn(request).userId);
  });
  app.post('/:id/leave', { onRequest: requireUser, schema: { params: Type.Object({ id: Uuid }) } }, async request => {
    const challenge = await getChallenge((request.params as { id: string }).id, idn(request)); const member = await participant(challenge, idn(request).userId);
    if (!member || !['joined', 'left'].includes(member.status)) fail(404, 'Participation not found');
    if (member.status === 'left') return member;
    return (await getDb().update(participants).set({ status: 'left' }).where(and(eq(participants.tenant_id, challenge.tenant_id), eq(participants.challenge_id, challenge.id), eq(participants.user_id, idn(request).userId))).returning())[0];
  });
  app.post('/:id/invites', { onRequest: requireUser, schema: { params: Type.Object({ id: Uuid }), body: Type.Optional(Type.Union([Invite, Type.Null()])) } }, async request => {
    const challenge = await getChallenge((request.params as { id: string }).id, idn(request)); await visible(challenge, idn(request));
    if (challenge.owner_id !== idn(request).userId) fail(403, 'Only the challenge owner can invite users'); open(challenge);
    const body = (request.body ?? {}) as Static<typeof Invite>; const inputIds = unique(body.user_ids ?? []); await validateUsers(inputIds, request);
    const emails = unique((body.emails ?? []).map(value => value.toLowerCase())); const userIds = unique([...inputIds, ...await resolveEmails(emails, request)]);
    for (const userId of userIds) {
      const prior = await participant(challenge, userId);
      if (!prior) await getDb().insert(participants).values({ tenant_id: challenge.tenant_id, challenge_id: challenge.id, user_id: userId, status: 'invited', joined_at: null });
      else if (prior.status === 'declined' || prior.status === 'left') await getDb().update(participants).set({ status: 'invited', joined_at: null }).where(and(eq(participants.tenant_id, challenge.tenant_id), eq(participants.challenge_id, challenge.id), eq(participants.user_id, userId)));
    }
    return { invite_code: challenge.invite_code, user_ids: userIds };
  });
}
