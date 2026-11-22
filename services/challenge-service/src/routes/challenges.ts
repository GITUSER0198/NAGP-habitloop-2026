import { randomUUID } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, inArray, lte, gte } from 'drizzle-orm';
import { getDb, invalidInput, requireInternal, requireUser } from '@habitloop/shared';
import { challenges, participants, posts } from '../db/schema.js';
import { registerWallRoutes } from './wall.js';
import { memberCommunities } from './membership.js';

const Uuid = Type.String({ format: 'uuid' });
// A challenge belongs to the community (tenant) it was created in. public: listed to every signed-in
// user (also on Discover) but only community members can join; members: visible and joinable by members only.
const Create = Type.Object({ title: Type.String({ minLength: 1, maxLength: 200 }), description: Type.Optional(Type.String({ maxLength: 10000 })),
  visibility: Type.Optional(Type.Union([Type.Literal('public'), Type.Literal('members')])), activity_category: Type.String({ minLength: 1, maxLength: 100 }),
  start_date: Type.String({ format: 'date' }), end_date: Type.String({ format: 'date' }), target_count: Type.Integer({ minimum: 1 }),
  image_url: Type.Optional(Type.String({ maxLength: 500, pattern: '^(/|https?://)' })), caring_value: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })), community_id: Type.Optional(Uuid) }, { additionalProperties: false });
type Identity = { userId: string; tenantId: string };
function fail(statusCode: number, message: string): never { throw Object.assign(new Error(message), { statusCode }); }
function today(): string { return new Date().toISOString().slice(0, 10); }
function idn(request: FastifyRequest): Identity { return request.user!; }
/** A challenge of any community the caller belongs to (not only the active one), else 404. */
async function getChallenge(id: string, request: FastifyRequest) {
  const tenantIds = (await memberCommunities(request)).map(item => item.id);
  const row = (await getDb().select().from(challenges).where(and(eq(challenges.id, id), inArray(challenges.tenant_id, tenantIds))).limit(1))[0];
  if (!row) fail(404, 'Challenge not found'); return row;
}
async function participant(challenge: typeof challenges.$inferSelect, userId: string) {
  return (await getDb().select().from(participants).where(and(eq(participants.tenant_id, challenge.tenant_id), eq(participants.challenge_id, challenge.id), eq(participants.user_id, userId))).limit(1))[0];
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

export async function registerChallengeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preValidation', async request => {
    const body = request.body as Record<string, unknown> | null;
    if (body && typeof body === 'object') {
      for (const field of ['title', 'activity_category', 'body']) if (typeof body[field] === 'string') body[field] = body[field].trim();
    }
  });
  await registerWallRoutes(app);
  app.post('/', { onRequest: requireUser, schema: { body: Create } }, async (request, reply) => {
    const body = request.body as Static<typeof Create>;
    const title = body.title.trim(); const category = body.activity_category.trim();
    if (!title || !category || body.end_date < body.start_date) invalidInput('end_date must be on or after start_date', body);
    // Created in the chosen community (must be a member), else in the active one.
    const tenantId = body.community_id ?? idn(request).tenantId;
    if (!(await memberCommunities(request)).some(item => item.id === tenantId)) fail(403, 'Not a member of this community');
    const created = (await getDb().insert(challenges).values({ id: randomUUID(), tenant_id: tenantId, owner_id: idn(request).userId,
      title, description: body.description ?? '', visibility: body.visibility ?? 'public', activity_category: category,
      start_date: body.start_date, end_date: body.end_date, target_count: body.target_count }).returning())[0]!;
    await getDb().insert(participants).values({ tenant_id: created.tenant_id, challenge_id: created.id, user_id: created.owner_id, status: 'joined', joined_at: new Date() });
    await getDb().insert(posts).values({ id: randomUUID(), tenant_id: created.tenant_id, challenge_id: created.id, author_id: created.owner_id, caption: created.description, image_url: body.image_url ?? null, caring_value: body.caring_value ?? null });
    return reply.code(201).send(created);
  });
  // Every challenge of the active community (the token's tenant): all members may see public and members-only ones.
  app.get('/feed', { onRequest: requireUser }, async request => {
    return getDb().select().from(challenges).where(eq(challenges.tenant_id, idn(request).tenantId)).orderBy(desc(challenges.start_date), asc(challenges.id));
  });
  // Challenges across every community I belong to, plus the communities, for the grouped Challenges page.
  app.get('/mine', { onRequest: requireUser }, async request => {
    const communities = await memberCommunities(request);
    const rows = await getDb().select().from(challenges).where(inArray(challenges.tenant_id, communities.map(item => item.id))).orderBy(desc(challenges.start_date), asc(challenges.id));
    return { communities, challenges: rows };
  });
  // Public challenges of any community, for Discover. Members-only challenges never appear here.
  app.get('/public/:community_id', { onRequest: requireUser, schema: { params: Type.Object({ community_id: Uuid }) } }, async request => {
    const { community_id } = request.params as { community_id: string };
    return getDb().select().from(challenges).where(and(eq(challenges.tenant_id, community_id), eq(challenges.visibility, 'public'))).orderBy(desc(challenges.start_date), asc(challenges.id));
  });
  app.get('/internal/users/:uid/active', { onRequest: [requireInternal, requireUser], schema: { hide: true, params: Type.Object({ uid: Uuid }), querystring: Type.Object({ category: Type.Optional(Type.String()) }) } }, async request => {
    const { uid } = request.params as { uid: string }; const query = request.query as { category?: string };
    const where = [eq(challenges.tenant_id, idn(request).tenantId), eq(participants.tenant_id, idn(request).tenantId), eq(participants.user_id, uid), eq(participants.status, 'joined'), lte(challenges.start_date, today()), gte(challenges.end_date, today())];
    if (query.category !== undefined) where.push(eq(challenges.activity_category, query.category));
    const rows = await getDb().select({ id: challenges.id }).from(challenges).innerJoin(participants, and(eq(participants.challenge_id, challenges.id), eq(participants.tenant_id, challenges.tenant_id))).where(and(...where)).orderBy(asc(challenges.id));
    return rows.map(row => row.id);
  });
  app.get('/:id', { onRequest: requireUser, schema: { params: Type.Object({ id: Uuid }) } }, async request => getChallenge((request.params as { id: string }).id, request));
  app.post('/:id/join', { onRequest: requireUser, schema: { params: Type.Object({ id: Uuid }) } }, async request => {
    const id = (request.params as { id: string }).id;
    const tenantIds = (await memberCommunities(request)).map(item => item.id);
    const mine = (await getDb().select().from(challenges).where(and(eq(challenges.id, id), inArray(challenges.tenant_id, tenantIds))).limit(1))[0];
    if (!mine) {
      // A public challenge of another community is visible, but taking part needs community membership first.
      const other = (await getDb().select({ id: challenges.id }).from(challenges).where(and(eq(challenges.id, id), eq(challenges.visibility, 'public'))).limit(1))[0];
      if (other) fail(409, 'Join the community first');
      fail(404, 'Challenge not found');
    }
    return join(mine, idn(request).userId);
  });
  app.post('/:id/leave', { onRequest: requireUser, schema: { params: Type.Object({ id: Uuid }) } }, async request => {
    const challenge = await getChallenge((request.params as { id: string }).id, request); const member = await participant(challenge, idn(request).userId);
    if (!member || !['joined', 'left'].includes(member.status)) fail(404, 'Participation not found');
    if (member.status === 'left') return member;
    return (await getDb().update(participants).set({ status: 'left' }).where(and(eq(participants.tenant_id, challenge.tenant_id), eq(participants.challenge_id, challenge.id), eq(participants.user_id, idn(request).userId))).returning())[0];
  });
}
