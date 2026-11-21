import { randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { getConfig, getDb, publish, requireUser } from '@habitloop/shared';
import { recommendations, type ScheduleValue } from '../db/schema.js';
import { NEEDS_DATA, evaluate, type ActivityHistory, type HourHistory, type LogHistory, type Suggestion } from '../rules.js';

type Identity = { userId: string; tenantId: string };
type Row = typeof recommendations.$inferSelect;
type Status = 'pending' | 'accepted' | 'dismissed';
const STATUSES: Status[] = ['pending', 'accepted', 'dismissed'];
const Id = Type.Object({ id: Type.String({ format: 'uuid' }) });
const StatusQuery = Type.Object({ status: Type.Optional(Type.Unsafe<Status>({ type: 'string', enum: STATUSES })) });
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_PATTERN = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

/** Tests replace `now` to pin the 14-day history window. */
export const clock = { now: (): Date => new Date() };

function fail(statusCode: number, message: string): never { throw Object.assign(new Error(message), { statusCode }); }
function identity(request: FastifyRequest): Identity { return request.user!; }
function serviceUrl(name: 'ACTIVITY' | 'ANALYTICS'): string { return process.env[`${name}_SERVICE_URL`] ?? `http://${name.toLowerCase()}-service:47820`; }
function serviceHeaders(request: FastifyRequest): Record<string, string> {
  return { authorization: request.headers.authorization ?? '', 'x-internal-token': getConfig().internalToken };
}

class InvalidHistory extends Error {}
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function uuid(value: unknown): string { if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new InvalidHistory(); return value.toLowerCase(); }
function integer(value: unknown): number {
  const number = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isInteger(number)) throw new InvalidHistory();
  return number;
}
function parseActivities(body: unknown): ActivityHistory[] {
  if (!Array.isArray(body)) throw new InvalidHistory();
  return body.map(item => {
    if (!isRecord(item) || typeof item.name !== 'string' || typeof item.active !== 'boolean' || typeof item.preferred_time !== 'string' || !TIME_PATTERN.test(item.preferred_time)) throw new InvalidHistory();
    if (item.frequency !== 'daily' && item.frequency !== 'weekly' && item.frequency !== 'custom') throw new InvalidHistory();
    if (typeof item.target_per_week !== 'number' || !Number.isInteger(item.target_per_week) || item.target_per_week < 1 || item.target_per_week > 7) throw new InvalidHistory();
    return { id: uuid(item.id), tenant_id: uuid(item.tenant_id), user_id: uuid(item.user_id), name: item.name, frequency: item.frequency,
      preferred_time: item.preferred_time, target_per_week: item.target_per_week, active: item.active };
  });
}
function parseHours(body: unknown): HourHistory[] {
  if (!Array.isArray(body)) throw new InvalidHistory();
  return body.map(item => {
    if (!isRecord(item)) throw new InvalidHistory();
    const hour = integer(item.hour); const attempts = integer(item.attempts); const successes = integer(item.successes);
    if (hour < 0 || hour > 23 || attempts < 0 || successes < 0 || successes > attempts) throw new InvalidHistory();
    return { hour, attempts, successes };
  });
}
function parseLogs(body: unknown): LogHistory[] {
  if (!Array.isArray(body)) throw new InvalidHistory();
  return body.map(item => {
    if (!isRecord(item) || (item.status !== 'done' && item.status !== 'completed' && item.status !== 'missed')) throw new InvalidHistory();
    // Aware datetimes only: the timestamp must carry Z or an offset.
    if (typeof item.logged_at !== 'string' || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(item.logged_at)) throw new InvalidHistory();
    const loggedAt = new Date(item.logged_at);
    if (Number.isNaN(loggedAt.getTime())) throw new InvalidHistory();
    return { tenant_id: uuid(item.tenant_id), user_id: uuid(item.user_id), activity_id: uuid(item.activity_id), status: item.status, logged_at: loggedAt };
  });
}
async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new InvalidHistory();
  return response.json();
}
async function readCandidates(request: FastifyRequest, user: Identity): Promise<[Suggestion[], boolean]> {
  const end = clock.now(); const start = new Date(end.getTime() - 14 * 86400000); const headers = serviceHeaders(request);
  const tenant = user.tenantId.toLowerCase(); const owner = user.userId.toLowerCase();
  try {
    const activities = parseActivities(await getJson(`${serviceUrl('ACTIVITY')}/api/activities`, headers))
      .filter(activity => activity.active && activity.tenant_id === tenant && activity.user_id === owner);
    if (!activities.length) return [[], true];
    const hours = parseHours(await getJson(`${serviceUrl('ANALYTICS')}/api/analytics/internal/users/${user.userId}/hours`, headers));
    const since = new URLSearchParams({ since: start.toISOString() });
    const logs = parseLogs(await getJson(`${serviceUrl('ACTIVITY')}/api/activities/internal/users/${user.userId}/logs?${since}`, headers))
      .filter(log => log.tenant_id === tenant && log.user_id === owner && start <= log.logged_at && log.logged_at <= end);
    return evaluate(activities, hours, logs);
  } catch { fail(503, 'Recommendation history is unavailable'); }
}

function scoped(user: Identity) { return and(eq(recommendations.tenant_id, user.tenantId), eq(recommendations.user_id, user.userId)); }
async function listed(user: Identity, status: Status): Promise<Row[]> {
  return getDb().select().from(recommendations).where(and(scoped(user), eq(recommendations.status, status))).orderBy(asc(recommendations.created_at), asc(recommendations.id));
}
function present(row: Row): Record<string, unknown> {
  return { id: row.id, tenant_id: row.tenant_id, user_id: row.user_id, activity_id: row.activity_id, kind: row.kind, current_value: row.current_value,
    suggested_value: row.suggested_value, reason: row.reason, confidence: row.confidence, status: row.status, created_at: row.created_at.toISOString() };
}
function result(rows: Row[], enoughData = true): Record<string, unknown> {
  return { recommendations: rows.map(present), ...(!rows.length && !enoughData ? { reason: NEEDS_DATA } : {}) };
}
function sameValue(a: ScheduleValue, b: ScheduleValue): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
}
async function owned(user: Identity, id: string): Promise<Row> {
  const row = (await getDb().select().from(recommendations).where(and(scoped(user), eq(recommendations.id, id.toLowerCase()))).limit(1))[0];
  if (!row) fail(404, 'Recommendation not found');
  return row;
}
function isDuplicate(error: unknown): boolean {
  const failure = error as { code?: string; cause?: { code?: string } };
  return failure.code === '23505' || failure.cause?.code === '23505';
}
let lastStamp = 0;
// Strictly increasing so rows made in one refresh keep their creation order.
function stamp(): Date { lastStamp = Math.max(Date.now(), lastStamp + 1); return new Date(lastStamp); }
// Serialises accept and dismiss per recommendation inside this process (the row lock the Python service took).
const locks = new Map<string, Promise<unknown>>();
async function exclusive<T>(id: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  const run = previous.then(work, work);
  const tail = run.catch(() => undefined);
  locks.set(id, tail);
  try { return await run; } finally { if (locks.get(id) === tail) locks.delete(id); }
}
async function setStatus(row: Row, status: Status): Promise<Row> {
  return (await getDb().update(recommendations).set({ status }).where(and(eq(recommendations.id, row.id), eq(recommendations.tenant_id, row.tenant_id))).returning())[0]!;
}

export async function registerRecommendationRoutes(app: FastifyInstance): Promise<void> {
  app.post('/refresh', { onRequest: requireUser }, async request => {
    const user = identity(request);
    const [candidates, enoughData] = await readCandidates(request, user);
    const pending = await listed(user, 'pending');
    for (const candidate of candidates) {
      if (pending.some(row => row.activity_id === candidate.activity.id && row.kind === candidate.kind
        && sameValue(row.current_value, candidate.current_value) && sameValue(row.suggested_value, candidate.suggested_value))) continue;
      try {
        // The partial unique index also deduplicates concurrent refreshes.
        const inserted = await getDb().insert(recommendations).values({ id: randomUUID(), tenant_id: user.tenantId, user_id: user.userId, activity_id: candidate.activity.id,
          kind: candidate.kind, current_value: candidate.current_value, suggested_value: candidate.suggested_value, reason: candidate.reason,
          confidence: candidate.confidence, status: 'pending', created_at: stamp() }).returning();
        pending.push(inserted[0]!);
      } catch (error) { if (!isDuplicate(error)) throw error; }
    }
    return result(await listed(user, 'pending'), enoughData);
  });
  const list = async (request: FastifyRequest): Promise<Record<string, unknown>> => {
    const user = identity(request); const status = (request.query as { status?: Status }).status ?? 'pending';
    const rows = await listed(user, status);
    let enoughData = true;
    if (!rows.length && status === 'pending') enoughData = (await readCandidates(request, user))[1];
    return result(rows, enoughData);
  };
  // Both spellings answer, as in the Python service; only the bare prefix is documented.
  app.get('/', { onRequest: requireUser, prefixTrailingSlash: 'no-slash', schema: { querystring: StatusQuery } }, list);
  app.get('/', { onRequest: requireUser, prefixTrailingSlash: 'slash', schema: { hide: true, querystring: StatusQuery } }, list);
  app.post('/:id/accept', { onRequest: requireUser, schema: { params: Id } }, async request => {
    const user = identity(request); const id = (request.params as { id: string }).id;
    return exclusive(id.toLowerCase(), async () => {
      const row = await owned(user, id);
      if (row.status === 'accepted') return present(row);
      if (row.status === 'dismissed') fail(409, 'Recommendation is dismissed');
      let response: Response;
      try {
        response = await fetch(`${serviceUrl('ACTIVITY')}/api/activities/internal/${row.activity_id}/schedule`, { method: 'PATCH', redirect: 'manual',
          headers: { ...serviceHeaders(request), 'content-type': 'application/json' }, body: JSON.stringify(row.suggested_value), signal: AbortSignal.timeout(5000) });
      } catch { fail(502, 'Recommendation could not be accepted; retry later'); }
      if (response.status === 404 || response.status === 409) { await setStatus(row, 'dismissed'); fail(409, 'Activity no longer applies'); }
      if (!response.ok) fail(502, 'Recommendation could not be accepted; retry later');
      try { await publish('RecommendationAccepted', { tenant_id: user.tenantId, user_id: user.userId, recommendation_id: row.id, activity_id: row.activity_id }); }
      catch { fail(502, 'Recommendation could not be accepted; retry later'); }
      return present(await setStatus(row, 'accepted'));
    });
  });
  app.post('/:id/dismiss', { onRequest: requireUser, schema: { params: Id } }, async request => {
    const user = identity(request); const id = (request.params as { id: string }).id;
    return exclusive(id.toLowerCase(), async () => {
      const row = await owned(user, id);
      if (row.status === 'accepted') fail(409, 'Recommendation is already accepted');
      return present(await setStatus(row, 'dismissed'));
    });
  });
}
