import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, eq, gte, lte, lt } from 'drizzle-orm';
import { getConfig, getDb, getPool, invalidInput, publish, requireInternal, requireUser } from '@habitloop/shared';
import { activities, activityLogs } from '../db/schema.js';

const Uuid = Type.String({ format: 'uuid' });
const Name = Type.String({ minLength: 1, maxLength: 200 });
const Category = Type.String({ minLength: 1, maxLength: 100 });
const Time = Type.String({ pattern: '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' });
const Day = Type.Integer({ minimum: 0, maximum: 6 });
const Target = Type.Integer({ minimum: 1, maximum: 7 });
const ActivityFields = { name: Name, category: Category, frequency: Type.Union([Type.Literal('daily'), Type.Literal('weekly'), Type.Literal('custom')]), days_of_week: Type.Array(Day), preferred_time: Time, target_per_week: Target };
const Create = Type.Object({ ...ActivityFields, frequency: Type.Optional(ActivityFields.frequency), days_of_week: Type.Optional(ActivityFields.days_of_week), preferred_time: Type.Optional(ActivityFields.preferred_time), target_per_week: Type.Optional(ActivityFields.target_per_week) }, { additionalProperties: false });
const Patch = Type.Object({ name: Type.Optional(Name), category: Type.Optional(Category), frequency: Type.Optional(ActivityFields.frequency), days_of_week: Type.Optional(Type.Array(Day)), preferred_time: Type.Optional(Time), target_per_week: Type.Optional(Target) }, { additionalProperties: false });
const Schedule = Type.Object({ preferred_time: Type.Optional(Time), days_of_week: Type.Optional(Type.Array(Day)), target_per_week: Type.Optional(Target) }, { additionalProperties: false });
const Duration = Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]));
const LogBody = Type.Object({ status: Type.Union([Type.Literal('done'), Type.Literal('completed'), Type.Literal('missed')]), logged_at: Type.Optional(Type.String({ format: 'date-time' })), duration_min: Duration }, { additionalProperties: false });
const InternalLog = Type.Object({ tenant_id: Uuid, user_id: Uuid, activity_id: Uuid, status: Type.Union([Type.Literal('done'), Type.Literal('completed'), Type.Literal('missed')]), logged_at: Type.String({ format: 'date-time' }), source: Type.Literal('partner'), source_event_id: Type.String({ minLength: 1, maxLength: 255, pattern: '\\S' }), duration_min: Duration, metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())) }, { additionalProperties: false });
type ActivityInput = Static<typeof Create>;
type LogInput = Static<typeof LogBody>;
type Identity = { userId: string; tenantId: string };

function fail(statusCode: number, message: string): never { throw Object.assign(new Error(message), { statusCode }); }
function cleanSchedule<T extends { frequency?: string; days_of_week?: number[] }>(body: T, current?: { frequency: string; days_of_week: number[] }): T {
  if (body.days_of_week) body.days_of_week = [...new Set(body.days_of_week)].sort((a, b) => a - b);
  const frequency = body.frequency ?? current?.frequency ?? 'daily';
  const days = body.days_of_week ?? current?.days_of_week ?? [];
  if ((frequency === 'weekly' || frequency === 'custom') && days.length === 0) invalidInput('Weekly and custom schedules require days_of_week', body);
  return body;
}
async function categories(): Promise<Record<string, string>> {
  const data = JSON.parse(await readFile(new URL('../../../../config/categories.json', import.meta.url), 'utf8')) as Record<string, string>;
  return data;
}
async function checkCategory(value: string): Promise<void> { if (!Object.hasOwn(await categories(), value)) invalidInput('Choose a configured category', value, ['body', 'category']); }
async function owned(id: string, identity: Identity) {
  const row = (await getDb().select().from(activities).where(and(eq(activities.id, id), eq(activities.tenant_id, identity.tenantId), eq(activities.user_id, identity.userId))).limit(1))[0];
  if (!row) fail(404, 'Activity not found');
  return row;
}
function identity(request: FastifyRequest): Identity { return request.user!; }
function headers(request: FastifyRequest): Record<string, string> {
  const authorization = request.headers.authorization;
  return { 'x-internal-token': getConfig().internalToken, ...(authorization ? { authorization } : {}) };
}
async function userTimezone(request: FastifyRequest): Promise<string> {
  const url = process.env.USER_SERVICE_URL ?? 'http://user-service:47820';
  const response = await fetch(`${url}/api/users/internal/users/${request.user!.userId}`, { headers: headers(request), signal: AbortSignal.timeout(3000) }).catch(() => undefined);
  if (!response?.ok) fail(503, 'User timezone is unavailable');
  try { const timezone = (await response.json() as { timezone?: unknown }).timezone; if (typeof timezone !== 'string' || !timezone) throw new Error('Missing timezone'); new Intl.DateTimeFormat('en', { timeZone: timezone }); return timezone; }
  catch { fail(503, 'User timezone is unavailable'); }
}
function localDate(date: Date, timezone: string): string {
  const values = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (name: string) => values.find(value => value.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function utcFromLocal(value: string, timezone: string): Date {
  const nominal = new Date(`${value}:00Z`);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const offsetAt = (instant: number) => {
    const formatted = formatter.formatToParts(new Date(instant));
    const read = (name: string) => Number(formatted.find(part => part.type === name)!.value);
    return Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second')) - instant;
  };
  const before = offsetAt(nominal.getTime() - 36 * 3600000);
  const after = offsetAt(nominal.getTime() + 36 * 3600000);
  const candidates = [...new Set([before, after])].map(offset => nominal.getTime() - offset)
    .filter(instant => instant + offsetAt(instant) === nominal.getTime()).sort((a, b) => a - b);
  // Match ZoneInfo's first occurrence for folds and pre-transition offset for gaps.
  return new Date(candidates[0] ?? nominal.getTime() - before);
}
function dueAt(value: string, timezone: string): string {
  const utc = utcFromLocal(value, timezone);
  const offset = Math.round((new Date(`${value}:00Z`).getTime() - utc.getTime()) / 60000);
  const sign = offset >= 0 ? '+' : '-';
  return `${value}:00${sign}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
}
async function activeChallengeIds(activity: typeof activities.$inferSelect, request: FastifyRequest): Promise<string[]> {
  try {
    const url = process.env.CHALLENGE_SERVICE_URL ?? 'http://challenge-service:47820';
    const response = await fetch(`${url}/api/challenges/internal/users/${activity.user_id}/active?category=${encodeURIComponent(activity.category)}`, { headers: headers(request), signal: AbortSignal.timeout(3000) });
    if (!response.ok) return [];
    const ids = await response.json();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return Array.isArray(ids) && ids.every(value => typeof value === 'string' && uuid.test(value)) ? ids : [];
  } catch { request.log.warn({ event: 'challenge_lookup_failed' }, 'challenge_lookup_failed'); return []; }
}
async function writeLog(activity: typeof activities.$inferSelect, body: LogInput, request: FastifyRequest, source: 'manual' | 'partner', extra: { source_event_id?: string; metadata?: Record<string, unknown> } = {}) {
  if (!activity.active) fail(source === 'manual' ? 404 : 404, 'Activity not found');
  const loggedAt = new Date(body.logged_at ?? new Date().toISOString());
  const id = randomUUID();
  const inserted = await getDb().insert(activityLogs).values({ id, tenant_id: activity.tenant_id, user_id: activity.user_id, activity_id: activity.id,
    status: body.status, logged_at: loggedAt, source, source_event_id: extra.source_event_id ?? null,
    duration_min: body.duration_min ?? null, metadata: extra.metadata ?? {} }).returning();
  try { await publish('ActivityLogged', { tenant_id: activity.tenant_id, user_id: activity.user_id, activity_id: activity.id, log_id: id,
    status: body.status, logged_at: loggedAt.toISOString().replace(/\.000Z$/, '+00:00').replace(/Z$/, '+00:00'), source, challenge_ids: await activeChallengeIds(activity, request) }); }
  catch { await getPool().query(`DELETE FROM "${getConfig().dbSchema}"."activity_logs" WHERE id=$1`, [id]); fail(502, 'Activity event could not be published'); }
  return inserted[0]!;
}
function mergedSchedule(body: Record<string, unknown>, existing: typeof activities.$inferSelect) {
  return cleanSchedule<Record<string, unknown> & { name: string; frequency?: string; days_of_week?: number[] }>({ name: existing.name, ...body }, existing);
}
function bounds(raw: string): Date {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(raw);
  const date = new Date(raw.length > 10 && !/(Z|[+-]\d{2}:\d{2})$/.test(raw) ? `${raw}Z` : raw);
  if (!match || !Number.isFinite(date.getTime()) || new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) !== match[1]) fail(422, 'Use an ISO date or timestamp for log bounds');
  return date;
}

export async function registerActivityRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preValidation', async request => {
    const body = request.body as Record<string, unknown> | null;
    if (body && typeof body === 'object') {
      for (const field of ['name', 'source_event_id']) if (typeof body[field] === 'string') body[field] = body[field].trim();
      for (const field of ['tenant_id', 'user_id', 'activity_id']) if (typeof body[field] === 'string') body[field] = body[field].toLowerCase();
    }
  });
  app.get('/categories', { onRequest: requireUser }, async () => categories());
  app.get('/today', { onRequest: requireUser }, async request => {
    const timezone = await userTimezone(request);
    const local = localDate(new Date(), timezone);
    const day = new Date(`${local}T12:00:00Z`);
    const weekday = (day.getUTCDay() + 6) % 7;
    const dayStart = utcFromLocal(`${local}T00:00`, timezone);
    const nextLocal = new Date(`${local}T12:00:00Z`); nextLocal.setUTCDate(nextLocal.getUTCDate() + 1);
    const nextDate = nextLocal.toISOString().slice(0, 10);
    const nextDay = utcFromLocal(`${nextDate}T00:00`, timezone);
    const id = identity(request);
    const rows = await getDb().select().from(activities).where(and(eq(activities.tenant_id, id.tenantId), eq(activities.user_id, id.userId), eq(activities.active, true))).orderBy(asc(activities.preferred_time), asc(activities.id));
    const logs = await getDb().select().from(activityLogs).where(and(eq(activityLogs.tenant_id, id.tenantId), eq(activityLogs.user_id, id.userId), gte(activityLogs.logged_at, dayStart), lt(activityLogs.logged_at, nextDay))).orderBy(asc(activityLogs.logged_at), asc(activityLogs.id));
    const latest = new Map<string, string>(); for (const log of logs) latest.set(log.activity_id, log.status);
    return rows.filter(row => row.frequency === 'daily' || row.days_of_week.includes(weekday)).map(row => ({ ...row, status: latest.get(row.id) ?? null,
      due_at: dueAt(`${local}T${row.preferred_time}`, timezone) }));
  });
  app.post('/internal/logs', { onRequest: requireInternal, schema: { hide: true, body: InternalLog } }, async (request, reply) => {
    const body = request.body as Static<typeof InternalLog>;
    body.source_event_id = body.source_event_id.trim();
    const activity = (await getDb().select().from(activities).where(and(eq(activities.id, body.activity_id), eq(activities.tenant_id, body.tenant_id), eq(activities.user_id, body.user_id))).limit(1))[0];
    if (!activity) fail(404, 'Activity not found');
    const prior = (await getDb().select().from(activityLogs).where(and(eq(activityLogs.tenant_id, body.tenant_id), eq(activityLogs.source_event_id, body.source_event_id))).limit(1))[0];
    if (prior) { if (prior.activity_id !== body.activity_id || prior.user_id !== body.user_id) fail(409, 'Source event already belongs to another activity'); reply.code(200); return { duplicate: true }; }
    try { reply.code(201); return await writeLog(activity, body, request, 'partner', { source_event_id: body.source_event_id, metadata: body.metadata }); }
    catch (error) {
      if ((error as { cause?: { code?: string } }).cause?.code === '23505' || (error as { code?: string }).code === '23505') { const existing = (await getDb().select().from(activityLogs).where(and(eq(activityLogs.tenant_id, body.tenant_id), eq(activityLogs.source_event_id, body.source_event_id))).limit(1))[0]; if (existing?.activity_id === body.activity_id && existing.user_id === body.user_id) { reply.code(200); return { duplicate: true }; } fail(409, 'Source event is already in use'); }
      throw error;
    }
  });
  app.get('/internal/users/:uid/logs', { onRequest: [requireInternal, requireUser], schema: { hide: true, params: Type.Object({ uid: Uuid }), querystring: Type.Object({ tenant_id: Type.Optional(Type.String({ format: 'uuid' })), since: Type.String({ format: 'date-time' }) }) } }, async request => {
    const { uid } = request.params as { uid: string }; const { since } = request.query as { since: string };
    return getDb().select().from(activityLogs).where(and(eq(activityLogs.tenant_id, (request.query as { tenant_id?: string }).tenant_id ?? request.user!.tenantId), eq(activityLogs.user_id, uid), gte(activityLogs.logged_at, bounds(since)))).orderBy(asc(activityLogs.logged_at), asc(activityLogs.id));
  });
  app.patch('/internal/:id/schedule', { onRequest: [requireInternal, requireUser], schema: { hide: true, params: Type.Object({ id: Uuid }), body: Schedule } }, async request => {
    const { id } = request.params as { id: string }; const current = await owned(id, identity(request)); if (!current.active) fail(409, 'Activity is no longer active');
    const body = request.body as Record<string, unknown>; const merged = mergedSchedule(body, current);
    const row = (await getDb().update(activities).set(merged).where(and(eq(activities.id, id), eq(activities.tenant_id, current.tenant_id))).returning())[0]; return row;
  });
  app.post('/', { onRequest: requireUser, schema: { body: Create } }, async (request, reply) => {
    const body = request.body as ActivityInput; if (!body.name.trim()) fail(422, 'Invalid name'); await checkCategory(body.category); const value = cleanSchedule({ frequency: 'daily', days_of_week: [], preferred_time: '09:00', target_per_week: 7, ...body });
    const id = identity(request); const row = (await getDb().insert(activities).values({ id: randomUUID(), tenant_id: id.tenantId, user_id: id.userId, name: body.name.trim(), category: body.category,
      frequency: value.frequency!, days_of_week: value.days_of_week!, preferred_time: value.preferred_time!, target_per_week: value.target_per_week!, active: true }).returning())[0];
    return reply.code(201).send(row);
  });
  app.get('/', { onRequest: requireUser }, async request => getDb().select().from(activities).where(and(eq(activities.tenant_id, identity(request).tenantId), eq(activities.user_id, identity(request).userId), eq(activities.active, true))).orderBy(asc(activities.name), asc(activities.id)));
  app.get('/:id', { onRequest: requireUser, schema: { params: Type.Object({ id: Uuid }) } }, async request => owned((request.params as { id: string }).id, identity(request)));
  app.patch('/:id', { onRequest: requireUser, schema: { params: Type.Object({ id: Uuid }), body: Patch } }, async request => {
    const current = await owned((request.params as { id: string }).id, identity(request)); if (!current.active) fail(409, 'Activity is no longer active');
    const body = request.body as Record<string, unknown>; if (typeof body.name === 'string' && !body.name.trim()) fail(422, 'Invalid name'); if (typeof body.category === 'string') await checkCategory(body.category);
    const merged = mergedSchedule(body, current); if (typeof body.name === 'string') merged.name = body.name.trim();
    return (await getDb().update(activities).set(merged).where(and(eq(activities.id, current.id), eq(activities.tenant_id, current.tenant_id))).returning())[0];
  });
  app.delete('/:id', { onRequest: requireUser, schema: { params: Type.Object({ id: Uuid }) } }, async (request, reply) => {
    const row = await owned((request.params as { id: string }).id, identity(request)); await getDb().update(activities).set({ active: false }).where(and(eq(activities.id, row.id), eq(activities.tenant_id, row.tenant_id))); return reply.code(204).send();
  });
  app.post('/:id/logs', { onRequest: requireUser, schema: { params: Type.Object({ id: Uuid }), body: LogBody } }, async (request, reply) => {
    const row = await owned((request.params as { id: string }).id, identity(request)); reply.code(201); return writeLog(row, request.body as LogInput, request, 'manual');
  });
  app.get('/:id/logs', { onRequest: requireUser, schema: { params: Type.Object({ id: Uuid }), querystring: Type.Object({ from: Type.Optional(Type.String()), to: Type.Optional(Type.String()) }) } }, async request => {
    const row = await owned((request.params as { id: string }).id, identity(request)); const query = request.query as { from?: string; to?: string };
    let lower: Date | undefined; let upper: Date | undefined; const dateUpper = !!query.to && /^\d{4}-\d{2}-\d{2}$/.test(query.to);
    if (query.from !== undefined) lower = bounds(query.from); if (query.to !== undefined) { upper = bounds(query.to); if (dateUpper) upper = new Date(upper.getTime() + 86400000); }
    if (lower && upper && (dateUpper ? lower >= upper : lower > upper)) fail(422, 'from must precede to');
    const conditions = [eq(activityLogs.tenant_id, row.tenant_id), eq(activityLogs.user_id, row.user_id), eq(activityLogs.activity_id, row.id)];
    if (lower) conditions.push(gte(activityLogs.logged_at, lower)); if (upper) conditions.push(dateUpper ? lt(activityLogs.logged_at, upper) : lte(activityLogs.logged_at, upper));
    return getDb().select().from(activityLogs).where(and(...conditions)).orderBy(asc(activityLogs.logged_at), asc(activityLogs.id));
  });
}
