import { setTimeout as wait } from 'node:timers/promises';
import { once } from 'node:events';
import type {} from '@fastify/swagger';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken, invalidInput, requireInternal, requireUser } from '@habitloop/shared';
import { getAnalyticsStore, type AnalyticsStore, type Item } from '../store.js';

const milestonesAt = [7, 30, 100];
const POLL_MS = 3000; const HEARTBEAT_MS = 15000;
type Identity = { tenantId: string; userId: string };
function pk(user: Identity): string { return `TENANT#${user.tenantId}#USER#${user.userId}`; }
function count(item: Item | undefined, field: string): number { return Number(item?.[field] ?? 0); }
function dayCount(item?: Item): Record<string, unknown> { return { done: count(item, 'done'), completed: count(item, 'completed'), missed: count(item, 'missed') }; }
function currentDay(): string { return new Date().toISOString().slice(0, 10); }
function dateRange(days: number, end = currentDay()): string[] {
  const date = new Date(`${end}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() - days + 1);
  return Array.from({ length: days }, (_, i) => { const next = new Date(date); next.setUTCDate(date.getUTCDate() + i); return next.toISOString().slice(0, 10); });
}
function liveStreak(streak: Item | undefined, today: string): number {
  const last = typeof streak?.last_date === 'string' ? streak.last_date : '';
  const difference = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86400000;
  return difference >= 0 && difference <= 1 ? count(streak, 'current') : 0;
}
async function rows(store: AnalyticsStore, user: Identity, days: number, signal?: AbortSignal): Promise<Record<string, unknown>[]> {
  const found = await store.query(pk(user), 'DAY#', signal); const byDate = new Map(found.map(item => [String(item.date ?? item.SK.slice(4)), item]));
  return dateRange(days).map(date => ({ date, ...dayCount(byDate.get(date)) }));
}
export async function summarySnapshot(store: AnalyticsStore, user: Identity, signal?: AbortSignal): Promise<[Record<string, unknown>, number]> {
  const streak = await store.get(pk(user), 'STREAK', signal); signal?.throwIfAborted();
  const daily = await rows(store, user, 7, signal);
  const today = daily[daily.length - 1]!;
  const successes = daily.reduce((sum, day) => sum + Number(day.done) + Number(day.completed), 0);
  const attempts = successes + daily.reduce((sum, day) => sum + Number(day.missed), 0);
  return [{ today, rate_7d: attempts ? successes / attempts : 0, current_streak: liveStreak(streak, currentDay()), best_streak: count(streak, 'best') }, count(streak, 'revision')];
}
function fail(statusCode: number, message: string): never { throw Object.assign(new Error(message), { statusCode }); }
async function remoteJson(url: string, request: FastifyRequest): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(url, { headers: { authorization: request.headers.authorization ?? '', 'x-internal-token': process.env.INTERNAL_TOKEN ?? '' }, signal: AbortSignal.timeout(3000) });
  let body: Record<string, unknown> = {};
  try {
    const value: unknown = await response.json();
    if (value && typeof value === 'object' && !Array.isArray(value)) body = value as Record<string, unknown>;
  } catch { /* handled below */ }
  return { response, body };
}
function streamIdentity(request: FastifyRequest): Promise<Identity> {
  const authorization = request.headers.authorization;
  const queryToken = (request.query as { token?: string | string[] }).token;
  const token = authorization?.match(/^Bearer (.+)$/i)?.[1] ?? (Array.isArray(queryToken) ? queryToken.at(-1) : queryToken);
  if (!token) return Promise.reject(Object.assign(new Error('Invalid or missing bearer token'), { statusCode: 401 }));
  return verifyToken(token).then(claims => ({ tenantId: claims.tenant_id as string, userId: claims.sub as string }))
    .catch(() => Promise.reject(Object.assign(new Error('Invalid or missing bearer token'), { statusCode: 401 })));
}
function eventData(data: Record<string, unknown>): string { return `event: summary\ndata: ${JSON.stringify(data)}\n\n`; }
export async function registerAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  const store = getAnalyticsStore();
  app.get('/summary', { onRequest: requireUser }, async request => (await summarySnapshot(store, request.user as Identity))[0]);
  const daily = async (request: FastifyRequest, daysDefault: number) => {
    const value = (request.query as { days?: string | string[] }).days;
    const raw = Array.isArray(value) ? value.at(-1) : value;
    const days = raw === undefined ? daysDefault : Number(raw);
    if ((raw !== undefined && !/^[+-]?\d+(?:\.0+)?$/.test(raw.trim())) || !Number.isInteger(days) || days < 1 || days > 3660) invalidInput('days must be between 1 and 3660', raw, ['query', 'days']);
    return rows(store, request.user as Identity, days);
  };
  app.get('/trend', { onRequest: requireUser }, request => daily(request, 30));
  app.get('/heatmap', { onRequest: requireUser }, request => daily(request, 365));
  app.get('/cohorts', { onRequest: requireUser }, async request => {
    const found = await store.query(pk(request.user as Identity), 'COHORT#');
    return found.map(item => { const attempts = count(item, 'attempts'); const successes = count(item, 'successes');
      return { week: item.week, ...dayCount(item), attempts, successes, rate: attempts ? successes / attempts : 0 }; });
  });
  app.get('/challenges/:id/progress', { onRequest: requireUser, schema: { params: Type.Object({ id: Type.String({ format: 'uuid' }) }) } }, async (request, reply) => {
    const id = (request.params as { id: string }).id.toLowerCase();
    const challengeBase = process.env.CHALLENGE_SERVICE_URL ?? 'http://challenge-service:47820';
    let challenge: { response: Response; body: Record<string, unknown> };
    try { challenge = await remoteJson(`${challengeBase}/api/challenges/${id}`, request); } catch { fail(503, 'Challenge could not be verified'); }
    if (challenge.response.status === 404) fail(404, 'Challenge not found');
    if (!challenge.response.ok || !Number.isInteger(challenge.body.target_count)) fail(503, 'Challenge could not be verified');
    const target = Number(challenge.body.target_count);
    const items = await store.query(`TENANT#${(request.user as Identity).tenantId}#CHALLENGE#${id}`, 'PROGRESS#');
    const board = items.map(item => ({ user_id: String(item.user_id ?? item.SK.slice('PROGRESS#'.length)), count: count(item, 'count'), target }));
    board.sort((a, b) => b.count - a.count || a.user_id.localeCompare(b.user_id));
    const names = new Map<string, string>();
    for (const entry of board) {
      if (!names.has(entry.user_id)) {
        try {
          const result = await remoteJson(`${process.env.USER_SERVICE_URL ?? 'http://user-service:47820'}/api/users/internal/users/${entry.user_id}`, request);
          if (result.response.status === 404) names.set(entry.user_id, 'Former participant');
          else if (!result.response.ok || typeof result.body.name !== 'string') fail(503, 'Participant names are unavailable');
          else names.set(entry.user_id, result.body.name);
        } catch (error) { if ((error as { statusCode?: number }).statusCode === 503) throw error; fail(503, 'Participant names are unavailable'); }
      }
    }
    return reply.send({ challenge_id: id, target, leaderboard: board.map((item, index) => ({ ...item, name: names.get(item.user_id), rank: index + 1 })) });
  });
  const scope = async (items: Item[], prefix: string) => {
    const byKey = new Map(items.map(item => [item.SK, item])); const streak = byKey.get(`${prefix}STREAK`);
    const current = liveStreak(streak, currentDay()); const earned = milestonesAt.filter(days => byKey.has(`${prefix}BADGE#${days}`))
      .map(days => ({ days, earned_date: byKey.get(`${prefix}BADGE#${days}`)!.earned_date }));
    const nextDays = milestonesAt.find(days => !earned.some(entry => entry.days === days));
    return { current_streak: current, best_streak: count(streak, 'best'), earned,
      next: nextDays ? { days: nextDays, days_remaining: Math.max(0, nextDays - current) } : null };
  };
  app.get('/milestones', { onRequest: requireUser }, async request => {
    const user = request.user as Identity; const userPk = pk(user);
    const badges = await store.query(userPk, 'BADGE#'); const streak = await store.query(userPk, 'STREAK');
    const activityItems = await store.query(userPk, 'ACTIVITY#');
    const activityIds = [...new Set(activityItems.map(item => item.SK.split('#')[1]).filter((value): value is string => !!value))].sort();
    return { overall: await scope([...badges, ...streak], ''), activities: await Promise.all(activityIds.map(async activityId => ({
      activity_id: activityId, ...await scope(activityItems.filter(item => item.SK.startsWith(`ACTIVITY#${activityId}#`)), `ACTIVITY#${activityId}#`)
    }))) };
  });
  app.get('/internal/users/:uid/hours', { onRequest: [requireInternal, requireUser], schema: { hide: true, params: Type.Object({ uid: Type.String({ format: 'uuid' }) }) } }, async request => {
    const uid = (request.params as { uid: string }).uid.toLowerCase(); const user = request.user as Identity;
    return (await store.query(pk({ tenantId: user.tenantId, userId: uid }), 'HOUR#')).map(item => ({ hour: item.SK.slice(5), attempts: count(item, 'attempts'), successes: count(item, 'successes') }));
  });
  app.get('/stream', async (request, reply) => stream(request, reply, store));
}

export type StreamRuntime = { pollMs?: number; heartbeatMs?: number; now?: () => number; sleep?: (signal: AbortSignal, delayMs: number) => Promise<void> };
export async function stream(request: FastifyRequest, reply: FastifyReply, store: AnalyticsStore, runtime: StreamRuntime = {}): Promise<void> {
  const user = await streamIdentity(request).catch(error => {
    request.log.warn({ event: 'auth_failed', auth_kind: 'bearer' }, 'auth_failed');
    reply.header('WWW-Authenticate', 'Bearer');
    throw error;
  });
  const response = reply.raw; const abort = new AbortController();
  const pollMs = runtime.pollMs ?? POLL_MS; const heartbeatMs = runtime.heartbeatMs ?? HEARTBEAT_MS; const now = runtime.now ?? Date.now;
  let heartbeatAt = now(); let previous: string | undefined;
  const disconnected = () => abort.abort();
  response.on('close', disconnected); request.raw.on('aborted', disconnected);
  if (response.destroyed || request.raw.aborted) disconnected();
  reply.hijack(); response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no', connection: 'keep-alive' });
  try {
    while (!abort.signal.aborted) {
      const snapshot = await summarySnapshot(store, user, abort.signal);
      if (abort.signal.aborted) break;
      const encoded = `${snapshot[1]}:${JSON.stringify(snapshot[0])}`;
      if (encoded !== previous) {
        if (!response.write(eventData(snapshot[0]))) await once(response, 'drain', { signal: abort.signal });
        previous = encoded;
      }
      if (now() - heartbeatAt >= heartbeatMs) { response.write(': heartbeat\n\n'); heartbeatAt = now(); }
      try { await (runtime.sleep ? runtime.sleep(abort.signal, pollMs) : wait(pollMs, undefined, { signal: abort.signal })); } catch { break; }
    }
  } catch (error) {
    if (!abort.signal.aborted) throw error;
  } finally {
    response.removeListener('close', disconnected); request.raw.removeListener('aborted', disconnected);
    if (!response.destroyed) response.end();
  }
}
