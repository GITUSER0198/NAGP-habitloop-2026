import { EventEmitter } from 'node:events';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp, signToken } from '@habitloop/shared';
import { registerAnalyticsRoutes, stream } from '../src/routes/analytics.js';
import { setAnalyticsStoreForTests, type AnalyticsStore, type Item } from '../src/store.js';

class MemoryStore implements AnalyticsStore {
  items = new Map<string, Item>();
  async get(pk: string, sk: string) { return this.items.get(`${pk}|${sk}`); }
  async query(pk: string, prefix: string) { return [...this.items.values()].filter(item => item.PK === pk && item.SK.startsWith(prefix)); }
  put(pk: string, sk: string, fields: Record<string, unknown> = {}) { this.items.set(`${pk}|${sk}`, { PK: pk, SK: sk, ...fields }); }
}
describe('Analytics Service HTTP contract parity (9 Python cases)', () => {
  let app: FastifyInstance; let store: MemoryStore;
  const tenant = '11111111-1111-4111-8111-111111111111'; const user = '22222222-2222-4222-8222-222222222222';
  const otherUser = '33333333-3333-4333-8333-333333333333'; let token: string;
  const today = () => new Date().toISOString().slice(0, 10);
  const date = (offset: number) => { const value = new Date(`${today()}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); };
  const upk = (tid = tenant, uid = user) => `TENANT#${tid}#USER#${uid}`;
  beforeAll(async () => {
    token = await signToken({ sub: user, tenant_id: tenant, email: 'test@example.com', name: 'Tester' });
    store = new MemoryStore(); setAnalyticsStoreForTests(store);
    app = await createApp('analytics-service-test', '/api/analytics');
    await app.register(async instance => registerAnalyticsRoutes(instance), { prefix: '/api/analytics' }); await app.ready();
  });
  beforeEach(() => { vi.restoreAllMocks(); store.items.clear(); });
  afterAll(async () => { setAnalyticsStoreForTests(undefined); if (app) await app.close(); });
  const auth = (value = token) => ({ authorization: `Bearer ${value}` });
  it('returns summary, zero-filled trend and heatmap, cohorts, and protected hours', async () => {
    store.put(upk(), `DAY#${date(-2)}`, { date: date(-2), done: 1 });
    store.put(upk(), `DAY#${today()}`, { date: today(), completed: 1, missed: 1 });
    store.put(upk(), `COHORT#${date(-3)}`, { week: date(-3), done: 1, completed: 1, missed: 1, attempts: 3, successes: 2 });
    store.put(upk(), 'STREAK', { current: 0, best: 1, last_date: date(0), revision: 2 });
    store.put(upk(), 'HOUR#07', { attempts: 3, successes: 2 });
    const summary = await app.inject({ url: '/api/analytics/summary', headers: auth() });
    expect(summary.json()).toEqual({ today: { date: today(), done: 0, completed: 1, missed: 1 }, rate_7d: 2 / 3, current_streak: 0, best_streak: 1 });
    for (const route of ['trend', 'heatmap']) {
      const rows = (await app.inject({ url: `/api/analytics/${route}?days=3`, headers: auth() })).json(); expect(rows).toHaveLength(3);
      expect(rows[1]).toEqual({ date: date(-1), done: 0, completed: 0, missed: 0 });
      expect((await app.inject({ url: `/api/analytics/${route}?days=0`, headers: auth() })).statusCode).toBe(422);
      expect((await app.inject({ url: `/api/analytics/${route}?days=3661`, headers: auth() })).statusCode).toBe(422);
    }
    expect((await app.inject({ url: '/api/analytics/trend', headers: auth() })).json()).toHaveLength(30);
    expect((await app.inject({ url: '/api/analytics/heatmap', headers: auth() })).json()).toHaveLength(365);
    expect((await app.inject({ url: '/api/analytics/cohorts', headers: auth() })).json()[0]).toEqual({ week: date(-3), done: 1, completed: 1, missed: 1, attempts: 3, successes: 2, rate: 2 / 3 });
    const hoursPath = `/api/analytics/internal/users/${user}/hours`;
    expect((await app.inject({ url: hoursPath, headers: auth() })).statusCode).toBe(401);
    expect((await app.inject({ url: hoursPath, headers: { ...auth(), 'x-internal-token': process.env.INTERNAL_TOKEN! } })).json()).toEqual([{ hour: '07', attempts: 3, successes: 2 }]);
    expect((await app.inject({ url: hoursPath, headers: { 'x-internal-token': process.env.INTERNAL_TOKEN! } })).statusCode).toBe(401);
  });
  it('keeps a current streak through today and expires it after a full gap day', async () => {
    store.put(upk(), 'STREAK', { current: 1, best: 1, last_date: date(-1), revision: 1 });
    expect((await app.inject({ url: '/api/analytics/summary', headers: auth() })).json().current_streak).toBe(1);
    store.put(upk(), 'STREAK', { current: 1, best: 1, last_date: date(-2), revision: 2 });
    expect((await app.inject({ url: '/api/analytics/summary', headers: auth() })).json().current_streak).toBe(0);
  });
  it('retains earned milestones at user and activity scope after streak break', async () => {
    const aid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    store.put(upk(), 'STREAK', { current: 7, best: 7, last_date: date(0) }); store.put(upk(), 'BADGE#7', { earned_date: date(-1) });
    store.put(upk(), `ACTIVITY#${aid}#STREAK`, { current: 7, best: 7, last_date: date(0) });
    store.put(upk(), `ACTIVITY#${aid}#BADGE#7`, { earned_date: date(-1) });
    let result = (await app.inject({ url: '/api/analytics/milestones', headers: auth() })).json();
    const expected = { current_streak: 7, best_streak: 7, earned: [{ days: 7, earned_date: date(-1) }], next: { days: 30, days_remaining: 23 } };
    expect(result).toEqual({ overall: expected, activities: [{ activity_id: aid, ...expected }] });
    store.put(upk(), 'STREAK', { current: 0, best: 7, last_date: date(-1) }); store.put(upk(), `ACTIVITY#${aid}#STREAK`, { current: 0, best: 7, last_date: date(-1) });
    result = (await app.inject({ url: '/api/analytics/milestones', headers: auth() })).json();
    expect(result.overall.earned).toEqual(expected.earned); expect(result.activities[0].earned).toEqual(expected.earned);
    expect(result.overall.current_streak).toBe(0); expect(result.overall.next).toEqual({ days: 30, days_remaining: 30 });
  });
  it('isolates each user resource by tenant and requires authentication', async () => {
    store.put(upk(), `DAY#${today()}`, { date: today(), completed: 1 });
    const outsider = await signToken({ sub: otherUser, tenant_id: '44444444-4444-4444-8444-444444444444', email: 'other@example.com', name: 'Other' });
    expect((await app.inject({ url: '/api/analytics/summary', headers: auth(outsider) })).json().today.completed).toBe(0);
    for (const route of ['trend', 'heatmap']) expect((await app.inject({ url: `/api/analytics/${route}`, headers: auth(outsider) })).json().every((row: Record<string, number>) => !row.done && !row.completed && !row.missed)).toBe(true);
    expect((await app.inject({ url: '/api/analytics/cohorts', headers: auth(outsider) })).json()).toEqual([]);
    expect((await app.inject({ url: '/api/analytics/milestones', headers: auth(outsider) })).json().activities).toEqual([]);
    expect((await app.inject({ url: `/api/analytics/internal/users/${user}/hours`, headers: { ...auth(outsider), 'x-internal-token': process.env.INTERNAL_TOKEN! } })).json()).toEqual([]);
    for (const route of ['summary', 'trend', 'heatmap', 'milestones', 'cohorts', 'stream']) expect((await app.inject({ url: `/api/analytics/${route}` })).statusCode).toBe(401);
  });
  it('checks challenge visibility, tenant partition, participant names, and upstream status parity', async () => {
    const cid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; const peer = otherUser; const foreign = '44444444-4444-4444-8444-444444444444';
    const cpk = `TENANT#${tenant}#CHALLENGE#${cid}`;
    store.put(cpk, `PROGRESS#${user}`, { user_id: user, count: 2 }); store.put(cpk, `PROGRESS#${peer}`, { user_id: peer, count: 4 });
    store.put(`TENANT#${foreign}#CHALLENGE#${cid}`, `PROGRESS#${foreign}`, { user_id: foreign, count: 99 });
    const lookups: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${token}`); expect(new Headers(init?.headers).get('x-internal-token')).toBe(process.env.INTERNAL_TOKEN);
      const url = new URL(String(input));
      if (url.pathname.includes('/api/users/internal/users/')) { lookups.push(url.pathname.split('/').at(-1)!); return new Response(JSON.stringify({ name: url.pathname.endsWith(user) ? 'Alex' : 'Sam' }), { status: 200 }); }
      return new Response(JSON.stringify({ target_count: 10 }), { status: 200 });
    });
    const path = `/api/analytics/challenges/${cid}/progress`; let result = await app.inject({ url: path, headers: auth() });
    expect(result.json()).toMatchObject({ target: 10, leaderboard: [{ count: 4, name: 'Sam', rank: 1 }, { count: 2, name: 'Alex', rank: 2 }] });
    expect(lookups.sort()).toEqual([user, peer].sort()); lookups.length = 0;
    expect((await app.inject({ url: path, headers: auth() })).statusCode).toBe(200); expect(lookups).toHaveLength(2);
    fetchSpy.mockImplementationOnce(async () => new Response('{}', { status: 404 }));
    expect((await app.inject({ url: path, headers: auth() })).statusCode).toBe(404);
    fetchSpy.mockImplementationOnce(async () => new Response('{}', { status: 503 }));
    expect((await app.inject({ url: path, headers: auth() })).statusCode).toBe(503);
  });
  it('authenticates SSE by header or query token and refuses an invalid header over a valid query token', async () => {
    store.put(upk(), `DAY#${today()}`, { date: today(), completed: 1 });
    expect((await app.inject({ url: '/api/analytics/stream?token=bad' })).statusCode).toBe(401);
    expect((await app.inject({ url: `/api/analytics/stream?token=${token}`, headers: auth('bad') })).statusCode).toBe(401);
    const address = await new Promise<string>(resolve => app.server.listen(0, '127.0.0.1', () => {
      const serverAddress = app.server.address(); if (serverAddress && typeof serverAddress !== 'string') resolve(`http://127.0.0.1:${serverAddress.port}`);
    }));
    const getFirstEvent = async (url: string, completed: number, headers?: Record<string, string>) => {
      const response = await fetch(url, { headers }); expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const reader = response.body!.getReader(); const frame = await reader.read(); expect(new TextDecoder().decode(frame.value)).toContain('event: summary');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expect(response.headers.get('x-accel-buffering')).toBe('no');
      const data = new TextDecoder().decode(frame.value).split('data: ')[1]!.split('\n')[0]!;
      expect(JSON.parse(data).today.completed).toBe(completed);
      await reader.cancel();
    };
    await getFirstEvent(`${address}/api/analytics/stream`, 1, auth());
    await getFirstEvent(`${address}/api/analytics/stream?token=${token}`, 1);
    const other = await signToken({ sub: user, tenant_id: '44444444-4444-4444-8444-444444444444', email: 'other@example.com', name: 'Other' });
    await getFirstEvent(`${address}/api/analytics/stream?token=${other}`, 0);
    await new Promise<void>((resolve, reject) => app.server.close(error => error ? reject(error) : resolve()));
  });
  it('polls every three seconds, emits changed summaries and a fifteen-second heartbeat, then stops', async () => {
    const requestRaw = new EventEmitter() as EventEmitter & { aborted: boolean }; requestRaw.aborted = false;
    const request = { headers: auth(), query: {}, raw: requestRaw } as never;
    const response = new EventEmitter() as EventEmitter & { destroyed: boolean; write: ReturnType<typeof vi.fn>; writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    response.destroyed = false; response.write = vi.fn(() => true); response.writeHead = vi.fn(); response.end = vi.fn();
    const reply = { raw: response, hijack: vi.fn() } as never; let clock = 0; let polls = 0;
    const task = stream(request, reply, store, { now: () => clock, sleep: async (signal, delayMs) => {
      expect(signal.aborted).toBe(false); expect(delayMs).toBe(3000); polls++; clock += delayMs;
      if (polls === 2) store.put(upk(), 'STREAK', { current: 0, best: 0, last_date: today(), revision: 2 });
      if (polls === 7) response.emit('close');
    } });
    await task;
    expect(polls).toBe(7);
    expect(response.write.mock.calls.filter(([value]) => String(value).startsWith('event: summary'))).toHaveLength(2);
    expect(response.write.mock.calls.filter(([value]) => String(value) === ': heartbeat\n\n')).toHaveLength(1);
    expect(response.listenerCount('close')).toBe(0); expect(requestRaw.listenerCount('aborted')).toBe(0); expect(response.end).toHaveBeenCalledTimes(1);
  });
  it('emits snapshots and heartbeats, then removes listeners and its poll timer on disconnect', async () => {
    const requestRaw = new EventEmitter() as EventEmitter & { aborted: boolean }; requestRaw.aborted = false;
    const request = { headers: auth(), query: {}, raw: requestRaw } as never;
    const response = new EventEmitter() as EventEmitter & { destroyed: boolean; write: ReturnType<typeof vi.fn>; writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    response.destroyed = false; response.write = vi.fn(() => true); response.writeHead = vi.fn(); response.end = vi.fn();
    const reply = { raw: response, hijack: vi.fn() } as never;
    const task = stream(request, reply, store); await new Promise(resolve => setTimeout(resolve, 40)); response.emit('close'); await task;
    expect(response.write).toHaveBeenCalledWith(expect.stringContaining('event: summary'));
    expect(response.end).toHaveBeenCalledTimes(1); expect(response.listenerCount('close')).toBe(0); expect(requestRaw.listenerCount('aborted')).toBe(0);
  });
  it('serves service health and documentation routes', async () => {
    for (const path of ['/health', '/api/analytics/health']) expect((await app.inject({ url: path })).json()).toEqual({ status: 'ok', service: 'analytics-service-test' });
    expect((await app.inject({ url: '/docs' })).statusCode).toBe(200); expect((await app.inject({ url: '/api/analytics/docs' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/analytics/openapi.json' })).statusCode).toBe(200);
  });
  it('matches complete empty summary and milestone JSON responses', async () => {
    const response = await app.inject({ url: '/api/analytics/summary', headers: auth() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ today: { date: today(), done: 0, completed: 0, missed: 0 }, rate_7d: 0, current_streak: 0, best_streak: 0 });
    const milestones = await app.inject({ url: '/api/analytics/milestones', headers: auth() });
    expect(milestones.statusCode).toBe(200);
    expect(milestones.json()).toEqual({ overall: { current_streak: 0, best_streak: 0, earned: [], next: { days: 7, days_remaining: 7 } }, activities: [] });
    for (const route of ['cohorts', `internal/users/${user}/hours`]) {
      const result = await app.inject({ url: `/api/analytics/${route}`, headers: { ...auth(), 'x-internal-token': process.env.INTERNAL_TOKEN! } });
      expect(result.statusCode).toBe(200); expect(result.json()).toEqual([]);
    }
  });
  it.each([undefined, 1, 2])('reports no current streak when last_date is missing or future (%s)', async offset => {
    const fields = { current: 5, best: 9, ...(offset === undefined ? {} : { last_date: date(offset) }) };
    store.put(upk(), 'STREAK', fields); store.put(upk(), 'ACTIVITY#test#STREAK', fields);
    expect((await app.inject({ url: '/api/analytics/summary', headers: auth() })).json()).toMatchObject({ current_streak: 0, best_streak: 9 });
    const milestones = (await app.inject({ url: '/api/analytics/milestones', headers: auth() })).json();
    expect(milestones.overall.current_streak).toBe(0); expect(milestones.activities[0].current_streak).toBe(0);
  });
  it('canonicalizes UUIDs before challenge lookup and DynamoDB partition selection', async () => {
    const cid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; const uid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    store.put(`TENANT#${tenant}#CHALLENGE#${cid}`, `PROGRESS#${user}`, { user_id: user, count: 1 });
    store.put(upk(tenant, uid), 'HOUR#07', { attempts: 1, successes: 1 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).includes('/api/challenges/')
      ? Response.json({ target_count: 10 }) : Response.json({ name: 'Alex' }));
    const response = await app.inject({ url: `/api/analytics/challenges/${cid.toUpperCase()}/progress`, headers: auth() });
    expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ challenge_id: cid, leaderboard: [{ count: 1 }] });
    expect(String(fetchSpy.mock.calls[0][0])).toContain(`/api/challenges/${cid}`);
    const hours = await app.inject({ url: `/api/analytics/internal/users/${uid.toUpperCase()}/hours`, headers: { ...auth(), 'x-internal-token': process.env.INTERNAL_TOKEN! } });
    expect(hours.statusCode).toBe(200); expect(hours.json()).toEqual([{ hour: '07', attempts: 1, successes: 1 }]);
  });
  it.each(['trend', 'heatmap'])('matches the full %s body, including zeros and range boundaries', async route => {
    store.put(upk(), `DAY#${date(-3)}`, { date: date(-3), completed: 99 });
    store.put(upk(), `DAY#${date(-2)}`, { date: date(-2), done: 2 });
    store.put(upk(), `DAY#${today()}`, { date: today(), completed: 3, missed: 1 });
    store.put(upk(), `DAY#${date(1)}`, { date: date(1), completed: 99 });
    const response = await app.inject({ url: `/api/analytics/${route}?days=3`, headers: auth() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { date: date(-2), done: 2, completed: 0, missed: 0 },
      { date: date(-1), done: 0, completed: 0, missed: 0 },
      { date: today(), done: 0, completed: 3, missed: 1 }
    ]);
    expect((await app.inject({ url: `/api/analytics/${route}?days=1`, headers: auth() })).json()).toEqual([response.json()[2]]);
    expect((await app.inject({ url: `/api/analytics/${route}?days=3660`, headers: auth() })).json()).toHaveLength(3660);
  });
  it.each(['0', '3661', '1.5', 'bad', '', '0x10', '1e2'])('rejects invalid days %s with a query validation detail array', async days => {
    for (const route of ['trend', 'heatmap']) {
      const response = await app.inject({ url: `/api/analytics/${route}?days=${days}`, headers: auth() });
      expect(response.statusCode).toBe(422); expect(response.json().detail).toEqual([expect.objectContaining({ loc: ['query', 'days'] })]);
    }
  });
  it('uses the last repeated days query parameter as Python does', async () => {
    for (const route of ['trend', 'heatmap']) {
      const response = await app.inject({ url: `/api/analytics/${route}?days=bad&days=2`, headers: auth() });
      expect(response.statusCode).toBe(200); expect(response.json()).toHaveLength(2);
      expect((await app.inject({ url: `/api/analytics/${route}?days=2&days=bad`, headers: auth() })).statusCode).toBe(422);
    }
  });
  it('returns zero rates for cohorts without attempts and counts no data outside the seven-day summary', async () => {
    store.put(upk(), 'COHORT#2026-11-16', { week: '2026-11-16' });
    store.put(upk(), `DAY#${date(-7)}`, { date: date(-7), missed: 99 });
    store.put(upk(), `DAY#${date(-6)}`, { date: date(-6), done: 2 });
    expect((await app.inject({ url: '/api/analytics/cohorts', headers: auth() })).json()).toEqual([
      { week: '2026-11-16', done: 0, completed: 0, missed: 0, attempts: 0, successes: 0, rate: 0 }
    ]);
    expect((await app.inject({ url: '/api/analytics/summary', headers: auth() })).json().rate_7d).toBe(1);
  });
  it('returns all earned badges in order, null next milestone, and sorts activity scopes', async () => {
    for (const days of [100, 7, 30]) store.put(upk(), `BADGE#${days}`, { earned_date: date(-days) });
    for (const aid of ['b', 'a']) store.put(upk(), `ACTIVITY#${aid}#STREAK`, { current: 1, best: 3, last_date: date(-2) });
    const result = (await app.inject({ url: '/api/analytics/milestones', headers: auth() })).json();
    expect(result.overall).toEqual({ current_streak: 0, best_streak: 0, earned: [7, 30, 100].map(days => ({ days, earned_date: date(-days) })), next: null });
    expect(result.activities).toEqual(['a', 'b'].map(activity_id => ({ activity_id, current_streak: 0, best_streak: 3, earned: [], next: { days: 7, days_remaining: 7 } })));
  });
  it('isolates same-user analytics across tenants and allows internal hours for a tenant peer', async () => {
    const foreign = '44444444-4444-4444-8444-444444444444';
    store.put(upk(), 'STREAK', { current: 7, best: 7, last_date: today() }); store.put(upk(), 'BADGE#7', { earned_date: today() });
    store.put(upk(), 'ACTIVITY#private#STREAK', { current: 7 });
    store.put(upk(tenant, otherUser), 'HOUR#20', { attempts: 2, successes: 1 });
    store.put(upk(foreign, otherUser), 'HOUR#20', { attempts: 99, successes: 99 });
    const outsider = await signToken({ sub: user, tenant_id: foreign, email: 'other@example.com', name: 'Other' });
    expect((await app.inject({ url: '/api/analytics/milestones', headers: auth(outsider) })).json()).toEqual({
      overall: { current_streak: 0, best_streak: 0, earned: [], next: { days: 7, days_remaining: 7 } }, activities: []
    });
    const path = `/api/analytics/internal/users/${otherUser}/hours`;
    const result = await app.inject({ url: path, headers: { ...auth(), 'x-internal-token': process.env.INTERNAL_TOKEN! } });
    expect(result.statusCode).toBe(200); expect(result.json()).toEqual([{ hour: '20', attempts: 2, successes: 1 }]);
  });
  it('matches complete challenge progress JSON, tie ordering, and former participant fallback', async () => {
    const cid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; const cpk = `TENANT#${tenant}#CHALLENGE#${cid}`;
    for (const uid of [otherUser, user]) store.put(cpk, `PROGRESS#${uid}`, { user_id: uid, count: 4 });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).includes('/api/challenges/')
      ? Response.json({ target_count: 10 }) : String(input).endsWith(user) ? Response.json({ name: 'Alex' }) : new Response('{}', { status: 404 }));
    const response = await app.inject({ url: `/api/analytics/challenges/${cid}/progress`, headers: auth() });
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ challenge_id: cid, target: 10, leaderboard: [
      { user_id: user, count: 4, target: 10, name: 'Alex', rank: 1 },
      { user_id: otherUser, count: 4, target: 10, name: 'Former participant', rank: 2 }
    ] });
  });
  it.each(['offline', '503', 'invalid-json', 'missing-target', 'null-body'])('maps challenge verification failure %s to Python 503 JSON', async failure => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (failure === 'offline') throw new Error('offline');
      return failure === '503' ? new Response('{}', { status: 503 }) : new Response(failure === 'invalid-json' ? '{' : failure === 'null-body' ? 'null' : '{}');
    });
    const response = await app.inject({ url: '/api/analytics/challenges/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/progress', headers: auth() });
    expect(response.statusCode).toBe(503); expect(response.json()).toEqual({ detail: 'Challenge could not be verified' });
  });
  it.each(['offline', '503', 'invalid-json', 'missing-name'])('maps participant lookup failure %s to Python 503 JSON', async failure => {
    const cid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    store.put(`TENANT#${tenant}#CHALLENGE#${cid}`, `PROGRESS#${user}`, { user_id: user, count: 1 });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      if (String(input).includes('/api/challenges/')) return Response.json({ target_count: 10 });
      if (failure === 'offline') throw new Error('offline');
      return failure === '503' ? new Response('{}', { status: 503 }) : new Response(failure === 'invalid-json' ? '{' : '{}');
    });
    const response = await app.inject({ url: `/api/analytics/challenges/${cid}/progress`, headers: auth() });
    expect(response.statusCode).toBe(503); expect(response.json()).toEqual({ detail: 'Participant names are unavailable' });
  });
  it('returns an empty challenge leaderboard and does not query aggregates or names for an invisible challenge', async () => {
    const cid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; const path = `/api/analytics/challenges/${cid}/progress`;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ target_count: 10 }));
    const response = await app.inject({ url: path, headers: auth() });
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ challenge_id: cid, target: 10, leaderboard: [] });
    const query = vi.spyOn(store, 'query'); fetchSpy.mockResolvedValue(new Response('{}', { status: 404 }));
    const missing = await app.inject({ url: path, headers: auth() });
    expect(missing.statusCode).toBe(404); expect(missing.json()).toEqual({ detail: 'Challenge not found' }); expect(query).not.toHaveBeenCalled();
  });
  it.each(['challenges/invalid/progress', 'internal/users/invalid/hours'])('rejects invalid path parameter for %s', async route => {
    const response = await app.inject({ url: `/api/analytics/${route}`, headers: { ...auth(), 'x-internal-token': process.env.INTERNAL_TOKEN! } });
    expect(response.statusCode).toBe(422); expect(response.json().detail).toEqual([expect.objectContaining({ loc: ['path', route.startsWith('challenges') ? 'id' : 'uid'] })]);
  });
  function connection(headers = auth(), query: Record<string, string> = {}) {
    const raw = Object.assign(new EventEmitter(), { aborted: false });
    const response = Object.assign(new EventEmitter(), { destroyed: false, write: vi.fn(() => true), writeHead: vi.fn(), end: vi.fn() });
    return { raw, response, request: { headers, query, raw } as never, reply: { raw: response, hijack: vi.fn() } as never };
  }
  it.each(['bearer', 'BEARER'])('accepts case-insensitive %s stream auth as Python does', async scheme => {
    const c = connection({ authorization: `${scheme} ${token}` });
    await stream(c.request, c.reply, store, { sleep: async () => { c.response.emit('close'); } });
    expect(c.response.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'content-type': 'text/event-stream; charset=utf-8' }));
  });
  it('ends a backpressured stream on disconnect without waiting for drain or leaking listeners', async () => {
    const c = connection(); c.response.write.mockReturnValue(false);
    const task = stream(c.request, c.reply, store);
    await vi.waitFor(() => expect(c.response.listenerCount('drain')).toBe(1));
    c.response.emit('close'); await task;
    for (const event of ['drain', 'close', 'error']) expect(c.response.listenerCount(event)).toBe(0);
    expect(c.raw.listenerCount('aborted')).toBe(0); expect(c.response.end).toHaveBeenCalledTimes(1);
  });
  it('cancels an in-flight DynamoDB read on disconnect and performs no later reads or writes', async () => {
    const c = connection();
    const get = vi.spyOn(store, 'get').mockImplementation((_pk, _sk, signal?: AbortSignal) => new Promise((_, reject) => {
      expect(signal).toBeDefined();
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
    }));
    const query = vi.spyOn(store, 'query'); const task = stream(c.request, c.reply, store);
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1)); c.raw.emit('aborted'); await task;
    expect(query).not.toHaveBeenCalled(); expect(c.response.write).not.toHaveBeenCalled();
    expect(c.response.listenerCount('close')).toBe(0); expect(c.raw.listenerCount('aborted')).toBe(0);
  });
  it('skips all polling for a connection that already disconnected during authentication', async () => {
    const c = connection(); c.raw.aborted = true;
    const get = vi.spyOn(store, 'get'); await stream(c.request, c.reply, store);
    expect(get).not.toHaveBeenCalled(); expect(c.response.write).not.toHaveBeenCalled();
  });
  it('emits a changed summary without a revision change and stays silent for unchanged polls', async () => {
    const c = connection(); let polls = 0;
    await stream(c.request, c.reply, store, { sleep: async () => {
      polls++;
      if (polls === 2) store.put(upk(), `DAY#${today()}`, { date: today(), done: 1 });
      if (polls === 4) c.response.emit('close');
    } });
    expect(c.response.write).toHaveBeenCalledTimes(2);
    expect(String(c.response.write.mock.calls[1][0])).toContain('"done":1');
  });
});
