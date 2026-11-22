import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, invalidInput, publish, requireInternal, requireUser, type UserClaims } from '@habitloop/shared';
import { links, partnerEvents } from '../db/schema.js';

const Uuid = Type.String({ format: 'uuid' });
const providers = [
  { provider: 'mockfit', activity_types: ['run', 'walk', 'cycle', 'swim'] },
  { provider: 'mockrun', activity_types: ['run', 'walk'] },
  { provider: 'galaxywatch', activity_types: ['walk', 'run', 'cycle', 'steps'] }
];
type IngestBody = {
  event_id: string;
  type: 'workout' | 'steps';
  started_at: string;
  duration_min?: number | null;
  steps?: number | null;
  provider_activity: string;
  avg_heart_rate?: number | null;
};
const LinkBody = Type.Object({
  provider: Type.Union([Type.Literal('mockfit'), Type.Literal('mockrun'), Type.Literal('galaxywatch')]),
  activity_map: Type.Record(Type.String(), Uuid)
}, { additionalProperties: false });
function id(request: FastifyRequest): UserClaims { return request.user!; }
function fail(statusCode: number, message: string): never { throw Object.assign(new Error(message), { statusCode }); }
function validMap(provider: string, map: Record<string, string>): boolean {
  const allowed = providers.find(item => item.provider === provider)?.activity_types ?? [];
  return Object.keys(map).every(activity => allowed.includes(activity));
}
function normalizedStartedAt(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[Tt _](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?([Zz]|[+-]\d{2}:?\d{2})$/);
  if (!match) return undefined;
  const [, date, hour, minute, second = '00', fraction, zone] = match;
  const day = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || Number(date!.slice(0, 4)) < 1 || day.toISOString().slice(0, 10) !== date ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return undefined;
  let offset = zone!.toUpperCase();
  if (offset !== 'Z') {
    const digits = offset.slice(1).replace(':', '');
    if (Number(digits.slice(0, 2)) > 23 || Number(digits.slice(2)) > 59) return undefined;
    offset = digits === '0000' ? 'Z' : `${offset[0]}${digits.slice(0, 2)}:${digits.slice(2)}`;
  }
  const microseconds = fraction?.slice(0, 6).padEnd(6, '0');
  return `${date}T${hour}:${minute}:${second}${microseconds && Number(microseconds) ? `.${microseconds}` : ''}${offset}`;
}
function payloadValid(value: unknown): value is IngestBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const allowed = new Set(['event_id', 'type', 'started_at', 'duration_min', 'steps', 'provider_activity', 'avg_heart_rate']);
  if (Object.keys(item).some(key => !allowed.has(key))) return false;
  if (typeof item.event_id !== 'string' || !item.event_id.length || item.event_id.length > 255 ||
      (item.type !== 'workout' && item.type !== 'steps') ||
      typeof item.provider_activity !== 'string' || !item.provider_activity.length || item.provider_activity.length > 255 ||
      normalizedStartedAt(item.started_at) === undefined) return false;
  if (item.type === 'workout') {
    if (!Number.isInteger(item.duration_min) || (item.duration_min as number) < 0) return false;
  } else if (item.duration_min !== undefined && item.duration_min !== null) {
    if (!Number.isInteger(item.duration_min) || (item.duration_min as number) < 0) return false;
  }
  if (item.steps !== undefined && item.steps !== null && (!Number.isInteger(item.steps) || (item.steps as number) < 0)) return false;
  if (item.avg_heart_rate !== undefined && item.avg_heart_rate !== null &&
      (typeof item.avg_heart_rate !== 'number' || !Number.isFinite(item.avg_heart_rate) || item.avg_heart_rate <= 0)) return false;
  return true;
}
function safeEqualHex(actual: string, expected: string): boolean {
  if (!/^sha256=[0-9a-f]{64}$/.test(actual)) return false;
  const left = Buffer.from(actual.slice(7), 'hex'); const right = Buffer.from(expected, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function registerIntegrationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/providers', { onRequest: requireUser }, async () => providers);
  app.post('/links', { onRequest: requireUser, schema: { body: LinkBody } }, async (request, reply) => {
    const body = request.body as { provider: string; activity_map: Record<string, string> };
    if (!validMap(body.provider, body.activity_map)) invalidInput('Map only activity types supported by this provider', body);
    body.activity_map = Object.fromEntries(Object.entries(body.activity_map).map(([activity, uuid]) => [activity, uuid.toLowerCase()]));
    const user = id(request);
    for (const activityId of new Set(Object.values(body.activity_map))) {
      const response = await fetch(`${process.env.ACTIVITY_SERVICE_URL ?? 'http://activity-service:47820'}/api/activities/${activityId}`, {
        headers: { authorization: request.headers.authorization ?? '' }, signal: AbortSignal.timeout(5000)
      }).catch(() => undefined);
      if (!response) fail(502, 'Mapped activities could not be validated');
      if (response.status === 404) fail(422, 'Mapped activity not found');
      if (!response.ok) fail(502, 'Mapped activities could not be validated');
    }
    const key = randomBytes(64).toString('base64url'); const row = (await getDb().insert(links).values({
      id: randomUUID(), tenant_id: user.tenantId, user_id: user.userId, provider: body.provider, status: 'active',
      ingest_key_hash: createHash('sha256').update(key).digest('hex'), activity_map: body.activity_map, created_at: new Date()
    }).returning())[0]!;
    return reply.code(201).send({ id: row.id, tenant_id: row.tenant_id, user_id: row.user_id, provider: row.provider,
      status: row.status, activity_map: row.activity_map, created_at: row.created_at, ingest_key: key });
  });
  app.get('/links', { onRequest: requireUser }, async request => getDb().select({ id: links.id, tenant_id: links.tenant_id, user_id: links.user_id,
    provider: links.provider, status: links.status, activity_map: links.activity_map, created_at: links.created_at }).from(links)
    .where(and(eq(links.tenant_id, id(request).tenantId), eq(links.user_id, id(request).userId), eq(links.status, 'active'))).orderBy(desc(links.created_at), desc(links.id)));
  app.delete('/links/:id', { onRequest: requireUser, schema: { params: Type.Object({ id: Uuid }) } }, async (request, reply) => {
    const user = id(request); const linkId = (request.params as { id: string }).id;
    const rows = await getDb().update(links).set({ status: 'deleted' }).where(and(eq(links.id, linkId), eq(links.tenant_id, user.tenantId), eq(links.user_id, user.userId), eq(links.status, 'active'))).returning({ id: links.id });
    if (!rows.length) fail(404, 'Link not found'); return reply.code(204).send();
  });
  app.get('/links/:id/events', { onRequest: requireUser, schema: { params: Type.Object({ id: Uuid }) } }, async request => {
    const user = id(request); const linkId = (request.params as { id: string }).id;
    const owned = await getDb().select({ id: links.id }).from(links).where(and(eq(links.id, linkId), eq(links.tenant_id, user.tenantId), eq(links.user_id, user.userId), eq(links.status, 'active'))).limit(1);
    if (!owned.length) fail(404, 'Link not found');
    return getDb().select().from(partnerEvents).where(and(eq(partnerEvents.link_id, linkId), eq(partnerEvents.tenant_id, user.tenantId))).orderBy(desc(partnerEvents.received_at), desc(partnerEvents.id)).limit(50);
  });
  app.post('/ingest/:link_id', { schema: { params: Type.Object({ link_id: Uuid }) } }, async (request, reply) => {
    const linkId = (request.params as { link_id: string }).link_id;
    const raw = request.rawBody;
    const signature = request.headers['x-habitloop-signature'];
    const link = (await getDb().select().from(links).where(and(eq(links.id, linkId), eq(links.status, 'active'))).limit(1))[0];
    if (!link) fail(404, 'Link not found');
    const bodyText = raw ?? Buffer.alloc(0);
    const actual = typeof signature === 'string' ? signature : '';
    const expected = createHmac('sha256', Buffer.from(link.ingest_key_hash, 'hex')).update(bodyText).digest('hex');
    if (!safeEqualHex(actual, expected)) fail(401, 'Invalid or missing partner signature');
    try { request.body = JSON.parse(bodyText.toString('utf8')); }
    catch { invalidInput('JSON decode error', null); }
    if (!payloadValid(request.body)) invalidInput('Invalid partner event', request.body);
    const body = request.body;
    const eventPayload: Record<string, unknown> = { ...body, started_at: normalizedStartedAt(body.started_at) };
    if (body.steps === null) delete eventPayload.steps;
    if (body.avg_heart_rate === null) delete eventPayload.avg_heart_rate;
    if (body.duration_min === null) delete eventPayload.duration_min;
    let inserted: typeof partnerEvents.$inferSelect;
    try {
      inserted = (await getDb().insert(partnerEvents).values({ id: randomUUID(), tenant_id: link.tenant_id, link_id: link.id,
        event_id: body.event_id, payload: eventPayload, status: 'received', received_at: new Date() }).returning())[0]!;
    } catch (error) {
      const wrapped = error as { code?: string; cause?: { code?: string }; message?: string };
      if (wrapped.code === '23505' || wrapped.cause?.code === '23505' || /duplicate key|unique constraint/i.test(wrapped.message ?? '')) return reply.code(200).send({ duplicate: true });
      throw error;
    }
    try {
      await publish('PartnerEventReceived', { tenant_id: link.tenant_id, user_id: link.user_id, link_id: link.id,
        partner_event_id: inserted.id, provider: link.provider, raw: eventPayload });
    } catch { fail(502, 'Partner event was stored but dispatch failed'); }
    return reply.code(202).send({ id: inserted.id, status: 'received' });
  });
  app.patch('/internal/events/:id', { onRequest: [requireInternal, requireUser], schema: { hide: true, params: Type.Object({ id: Uuid }), body: Type.Object({ status: Type.Union([Type.Literal('received'), Type.Literal('normalized'), Type.Literal('rejected')]), reason: Type.Optional(Type.Union([Type.String(), Type.Null()])) }, { additionalProperties: false }) } }, async request => {
    const { id: eventId } = request.params as { id: string }; const body = request.body as { status: string; reason?: string | null };
    const reason = body.reason?.trim() ?? null;
    if (reason !== null && (reason.length < 1 || reason.length > 1000)) invalidInput('Reason must contain between 1 and 1000 characters', body.reason, ['body', 'reason']);
    const user = id(request);
    const existing = await getDb().select({ id: partnerEvents.id }).from(partnerEvents).innerJoin(links, eq(links.id, partnerEvents.link_id))
      .where(and(eq(partnerEvents.id, eventId), eq(partnerEvents.tenant_id, user.tenantId), eq(links.tenant_id, user.tenantId), eq(links.user_id, user.userId))).limit(1);
    if (!existing.length) fail(404, 'Partner event not found');
    const rows = await getDb().update(partnerEvents).set({ status: body.status, reason }).where(and(eq(partnerEvents.id, eventId), eq(partnerEvents.tenant_id, user.tenantId))).returning();
    return rows[0];
  });
}
