import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { createApp, getPool, signToken } from '@habitloop/shared';
import { initializeActivityTables } from '../src/db/init.js';
import { registerActivityRoutes } from '../src/routes/activities.js';

describe('Python activity contract parity', () => {
  const prefix = '/api/activities';
  const tenant = randomUUID(); const user = randomUUID(); const peer = randomUUID(); const foreignTenant = randomUUID();
  let app: FastifyInstance;
  let auth: Record<string, string>; let foreign: Record<string, string>; let peerAuth: Record<string, string>;
  const secret = { 'x-internal-token': process.env.INTERNAL_TOKEN! };
  let timezone: unknown; let userStatus: number; let challengeStatus: number; let challengeIds: unknown; let publishFails: boolean;
  const emitted: Record<string, unknown>[] = [];
  const outgoing: { url: URL; headers: Headers }[] = [];
  const call = (method: InjectOptions['method'], path = '', payload?: unknown, headers = auth) =>
    app.inject({ method, url: prefix + path, headers, ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }), ...(payload === undefined ? {} : { headers: { ...headers, 'content-type': 'application/json' } }) });
  const internal = () => ({ ...auth, ...secret });
  async function create(changes: Record<string, unknown> = {}) {
    const result = await call('POST', '', { name: 'Run', category: 'fitness', ...changes });
    expect(result.statusCode, result.body).toBe(201); return result.json();
  }
  function partner(activity_id: string, changes: Record<string, unknown> = {}) {
    return { tenant_id: tenant, user_id: user, activity_id, status: 'completed', logged_at: '2026-11-19T09:00:00+05:30', source: 'partner', source_event_id: randomUUID(), duration_min: 30, metadata: { steps: 4500 }, ...changes };
  }
  beforeAll(async () => {
    app = await createApp('activity-service', prefix);
    await app.register(registerActivityRoutes, { prefix }); await app.ready(); await initializeActivityTables();
    const token = async (sub: string, tenant_id: string) => ({ authorization: `Bearer ${await signToken({ sub, tenant_id, email: 'test@example.com', name: 'Test' })}` });
    auth = await token(user, tenant); foreign = await token(user, foreignTenant); peerAuth = await token(peer, tenant);
  });
  beforeEach(async () => {
    auth = { authorization: `Bearer ${await signToken({ sub: user, tenant_id: tenant, email: 'test@example.com', name: 'Test' })}` };
    await getPool().query('DELETE FROM "activities_test"."activity_logs"');
    await getPool().query('DELETE FROM "activities_test"."activities"');
    timezone = 'UTC'; userStatus = 200; challengeStatus = 200; challengeIds = []; publishFails = false; emitted.length = 0; outgoing.length = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
      const url = new URL(String(input)); outgoing.push({ url, headers: new Headers(options?.headers) });
      if (url.pathname.includes('/api/users/')) return Response.json({ timezone }, { status: userStatus });
      if (url.pathname.endsWith('/active')) return Response.json(challengeIds, { status: challengeStatus });
      if (publishFails) throw new Error('Unavailable');
      emitted.push(JSON.parse(options!.body as string)); return new Response(null, { status: 202 });
    });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  afterAll(async () => { await app.close(); });

  it('preserves CRUD, configured categories, log shape and soft deletion', async () => {
    expect((await call('GET', '/categories')).json()).toEqual(JSON.parse(await readFile(new URL('../../../config/categories.json', import.meta.url), 'utf8')));
    const activity = await create(); const path = `/${activity.id}`;
    expect(activity).toEqual({ id: activity.id, tenant_id: tenant, user_id: user, name: 'Run', category: 'fitness', frequency: 'daily', days_of_week: [], preferred_time: '09:00', target_per_week: 7, active: true });
    expect((await call('GET', path)).json()).toEqual(activity);
    expect((await call('GET')).json()).toEqual([activity]);
    const updated = await call('PATCH', path, { name: 'Evening run', preferred_time: '21:30' });
    expect(updated.statusCode).toBe(200); expect(updated.json().preferred_time).toBe('21:30');
    const log = await call('POST', `${path}/logs`, { status: 'done', duration_min: null });
    expect(log.statusCode, log.body).toBe(201);
    expect(log.json()).toEqual({ id: log.json().id, tenant_id: tenant, user_id: user, activity_id: activity.id, status: 'done', logged_at: expect.any(String), source: 'manual', source_event_id: null, duration_min: null, metadata: {} });
    expect(emitted).toHaveLength(1);
    const deleted = await call('DELETE', path); expect(deleted.statusCode).toBe(204); expect(deleted.body).toBe('');
    expect((await call('GET', path)).json().active).toBe(false); expect((await call('GET')).json()).toEqual([]);
    expect((await call('GET', `${path}/logs`)).json()).toEqual([log.json()]);
    expect((await call('POST', `${path}/logs`, { status: 'done' })).statusCode).toBe(404);
    expect((await call('PATCH', path, { name: 'Again' })).statusCode).toBe(409);
    expect((await getPool().query('SELECT id FROM "activities_test"."activities"')).rows).toHaveLength(1);
  });
  it.each([
    { preferred_time: '25:00' }, { preferred_time: '09:60' }, { preferred_time: '9:00' }, { category: 'unknown' },
    { frequency: 'weekly', days_of_week: [] }, { frequency: 'custom', days_of_week: [] }, { days_of_week: [-1] },
    { days_of_week: [7] }, { days_of_week: [true] }, { target_per_week: 0 }, { name: ' ' }, { frequency: 'monthly' },
    { target_per_week: true }, { target_per_week: 8 }, { tenant_id: tenant },
  ])('rejects invalid creation %j with 422', async changes => {
    const result = await call('POST', '', { name: 'Run', category: 'fitness', ...changes }); expect(result.statusCode).toBe(422);
  });
  it('validates merged patches atomically and deduplicates days', async () => {
    const activity = await create({ frequency: 'weekly', days_of_week: [4, 1, 1] }); const path = `/${activity.id}`;
    expect(activity.days_of_week).toEqual([1, 4]);
    for (const body of [{ days_of_week: [] }, { category: 'bad' }, { preferred_time: '25:00' }, { name: null }]) expect((await call('PATCH', path, body)).statusCode).toBe(422);
    expect((await call('GET', path)).json()).toEqual(activity);
    expect((await call('PATCH', path, {})).statusCode).toBe(200);
    expect((await call('PATCH', path, { frequency: 'daily', days_of_week: [] })).statusCode).toBe(200);
  });
  it('supports collection trailing slashes', async () => {
    const result = await call('POST', '/', { name: 'Read', category: 'learning' }); expect(result.statusCode).toBe(201);
    expect((await call('GET', '/')).json()).toEqual([result.json()]);
  });
  it('isolates every activity and log route by tenant and owner', async () => {
    const activity = await create(); const path = `/${activity.id}`;
    expect((await call('POST', `${path}/logs`, { status: 'done' })).statusCode).toBe(201);
    for (const headers of [foreign, peerAuth]) {
      expect((await call('GET', '', undefined, headers)).json()).toEqual([]);
      expect((await call('GET', '/today', undefined, headers)).json()).toEqual([]);
      for (const [method, suffix, body] of [['GET', '', undefined], ['PATCH', '', { name: 'Stolen' }], ['DELETE', '', undefined], ['GET', '/logs', undefined], ['POST', '/logs', { status: 'done' }]] as const)
        expect((await call(method, path + suffix, body, headers)).statusCode).toBe(404);
    }
    expect((await call('GET', `/internal/users/${user}/logs?since=2020-01-01T00:00:00Z`, undefined, { ...foreign, ...secret })).json()).toEqual([]);
    expect((await call('PATCH', `/internal/${activity.id}/schedule`, { preferred_time: '10:00' }, { ...foreign, ...secret })).statusCode).toBe(404);
  });
  it('publishes ActivityLogged once with challenges and normalizes partner timestamps', async () => {
    const activity = await create(); const challenge = randomUUID(); challengeIds = [challenge];
    const body = partner(activity.id.toUpperCase(), { tenant_id: tenant.toUpperCase(), user_id: user.toUpperCase() });
    const first = await call('POST', '/internal/logs', body, internal()); expect(first.statusCode).toBe(201); expect(first.json().metadata).toEqual(body.metadata);
    expect((await call('POST', '/internal/logs', body, internal())).json()).toEqual({ duplicate: true });
    expect((await getPool().query('SELECT id FROM "activities_test"."activity_logs"')).rows).toHaveLength(1);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual({ source: 'habitloop.activity', 'detail-type': 'ActivityLogged', detail: { tenant_id: tenant, user_id: user, activity_id: activity.id, log_id: first.json().id, status: 'completed', logged_at: '2026-11-19T03:30:00+00:00', source: 'partner', challenge_ids: [challenge] } });
    const lookup = outgoing.find(item => item.url.pathname.endsWith('/active'))!;
    expect(lookup.url.searchParams.get('category')).toBe('fitness'); expect(lookup.headers.get('authorization')).toBe(auth.authorization); expect(lookup.headers.get('x-internal-token')).toBe(secret['x-internal-token']);
    await call('DELETE', `/${activity.id}`);
    const replay = await call('POST', '/internal/logs', body, internal()); expect(replay.statusCode).toBe(200); expect(replay.json()).toEqual({ duplicate: true }); expect(emitted).toHaveLength(1);
  });
  it('accepts internal-token-only logs, checks body ownership and conflicts', async () => {
    const first = await create(); const second = await create(); const body = partner(first.id, { duration_min: null });
    for (const changed of [{ tenant_id: randomUUID() }, { user_id: randomUUID() }]) expect((await call('POST', '/internal/logs', { ...body, ...changed }, secret)).statusCode).toBe(404);
    expect((await call('POST', '/internal/logs', body, secret)).statusCode).toBe(201);
    expect((await call('POST', '/internal/logs', { ...body, activity_id: second.id }, secret)).statusCode).toBe(409); expect(emitted).toHaveLength(1);
  });
  it('deduplicates concurrent partner retries and rejects cross-tenant event collisions', async () => {
    const activity = await create(); const body = partner(activity.id);
    const results = await Promise.all([call('POST', '/internal/logs', body, secret), call('POST', '/internal/logs', body, secret)]);
    expect(results.map(result => result.statusCode).sort()).toEqual([200, 201]); expect(emitted).toHaveLength(1);
    const foreignActivity = await call('POST', '', { name: 'Foreign', category: 'fitness' }, foreign);
    const collision = await call('POST', '/internal/logs', { ...body, tenant_id: foreignTenant, activity_id: foreignActivity.json().id }, secret);
    expect(collision.statusCode).toBe(409); expect(emitted).toHaveLength(1);
  });
  it.each([[503, []], [200, {}], [200, ['not-a-uuid']]] as const)('keeps logs with empty challenges on lookup failure %j %j', async (status, payload) => {
    challengeStatus = status; challengeIds = payload; const activity = await create();
    expect((await call('POST', `/${activity.id}/logs`, { status: 'missed' })).statusCode).toBe(201);
    expect(emitted[0].detail).toMatchObject({ challenge_ids: [] }); expect((await call('GET', `/${activity.id}/logs`)).json()).toHaveLength(1);
  });
  it('filters log boundaries and validates internal schedules', async () => {
    const activity = await create({ frequency: 'weekly', days_of_week: [0, 3] }); const path = `/${activity.id}/logs`;
    for (const [status, logged_at] of [['done', '2026-11-18T10:00:00Z'], ['completed', '2026-11-19T23:59:59Z'], ['missed', '2026-11-20T00:00:00Z']]) expect((await call('POST', path, { status, logged_at })).statusCode).toBe(201);
    expect((await call('GET', `${path}?from=2026-11-19&to=2026-11-19`)).json().map((row: { status: string }) => row.status)).toEqual(['completed']);
    expect((await call('GET', `${path}?from=2026-11-19T12:00:00Z&to=2026-11-19`)).statusCode).toBe(200);
    expect((await call('GET', `${path}?from=2026-11-19T23:59:59Z&to=2026-11-19T23:59:59Z`)).json()).toHaveLength(1);
    for (const query of ['from=invalid', 'from=2026-11-20&to=2026-11-19', 'from=', 'from=2026-02-30']) expect((await call('GET', `${path}?${query}`)).statusCode).toBe(422);
    expect((await call('GET', `/internal/users/${user}/logs?since=2026-11-19T00:00:00Z`, undefined, internal())).json().map((row: { status: string }) => row.status)).toEqual(['completed', 'missed']);
    const schedule = `/internal/${activity.id}/schedule`;
    const result = await call('PATCH', schedule, { preferred_time: '21:00', days_of_week: [2], target_per_week: 3 }, internal()); expect(result.statusCode).toBe(200); expect(result.json().target_per_week).toBe(3);
    expect((await call('PATCH', schedule, {}, internal())).statusCode).toBe(200);
    for (const body of [{ days_of_week: [] }, { preferred_time: '25:00' }, { target_per_week: null }, { name: 'No' }]) expect((await call('PATCH', schedule, body, internal())).statusCode).toBe(422);
    await call('DELETE', `/${activity.id}`); expect((await call('PATCH', schedule, { preferred_time: '10:00' }, internal())).statusCode).toBe(409);
  });
  it('uses the local day, latest status, schedule days, and local due_at', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-21T18:00:00Z')); timezone = 'Pacific/Kiritimati';
    auth = { authorization: `Bearer ${await signToken({ sub: user, tenant_id: tenant, email: 'test@example.com', name: 'Test' })}` };
    const daily = await create({ preferred_time: '07:15' }); const weekly = await create({ frequency: 'weekly', days_of_week: [6] });
    await create({ frequency: 'custom', days_of_week: [0] }); const removed = await create(); await call('DELETE', `/${removed.id}`);
    for (const [logged_at, status] of [['2026-11-20T10:30:00Z', 'missed'], ['2026-11-21T10:30:00Z', 'done'], ['2026-11-21T11:30:00Z', 'completed']]) await call('POST', `/${daily.id}/logs`, { status, logged_at });
    const result = await call('GET', '/today'); expect(result.statusCode).toBe(200);
    expect(result.json().map((item: { id: string }) => item.id).sort()).toEqual([daily.id, weekly.id].sort());
    expect(result.json().find((item: { id: string }) => item.id === daily.id)).toMatchObject({ status: 'completed', due_at: '2026-11-22T07:15:00+14:00' });
    expect(result.json().find((item: { id: string }) => item.id === weekly.id).status).toBeNull();
    expect(outgoing.at(-1)!.headers.get('authorization')).toBe(auth.authorization);
  });
  it.each([
    ['2027-03-14T12:00:00Z', '2027-03-14T03:15:00-04:00'],
    ['2027-11-07T12:00:00Z', '2027-11-07T03:15:00-05:00'],
  ])('resolves due_at after daylight saving transitions at %s', async (now, expected) => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(now)); timezone = 'America/New_York';
    auth = { authorization: `Bearer ${await signToken({ sub: user, tenant_id: tenant, email: 'test@example.com', name: 'Test' })}` };
    await create({ preferred_time: '03:15' }); expect((await call('GET', '/today')).json()[0].due_at).toBe(expected);
  });
  it.each(['Invalid/Zone', undefined, null, ''])('returns 503 for unavailable timezone %j', async value => {
    timezone = value; const result = await call('GET', '/today'); expect(result.statusCode).toBe(503); expect(result.json()).toEqual({ detail: 'User timezone is unavailable' });
  });
  it.each([{ status: 'invalid' }, { status: 'done', duration_min: -1 }, { status: 'done', logged_at: '2026-11-19T09:00:00' }])('rejects invalid logs %j', async body => {
    const activity = await create(); expect((await call('POST', `/${activity.id}/logs`, body)).statusCode).toBe(422);
  });
  it('requires internal and public authentication before validation', async () => {
    const activity = await create(); const schedule = `/internal/${activity.id}/schedule`;
    for (const headers of [auth, secret, { ...auth, 'x-internal-token': 'invalid' }]) expect((await call('PATCH', schedule, {}, headers)).statusCode).toBe(401);
    expect((await call('POST', '/internal/logs', {}, {})).statusCode).toBe(401); expect((await call('GET', '', undefined, {})).statusCode).toBe(401);
  });
  it('rolls back a log when publishing fails', async () => {
    const activity = await create(); publishFails = true; const path = `/${activity.id}/logs`;
    const result = await call('POST', path, { status: 'done' }); expect(result.statusCode).toBe(502); expect(result.json()).toEqual({ detail: 'Activity event could not be published' }); expect((await call('GET', path)).json()).toEqual([]);
  });
  it('serves both health paths, request ids and documentation', async () => {
    for (const path of ['/health', `${prefix}/health`]) { const result = await app.inject(path); expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ status: 'ok', service: 'activity-service' }); expect(result.headers['x-request-id']).toBeTruthy(); }
    for (const path of ['/docs', `${prefix}/docs`, `${prefix}/openapi.json`]) expect((await app.inject(path)).statusCode).toBe(200);
  });
  it('returns validation error lists, scoped parameter errors and explicit bound errors', async () => {
    const invalid = await call('POST', '', { name: 'Run', category: 'fitness', days_of_week: [true] });
    expect(invalid.statusCode).toBe(422); expect(invalid.json().detail).toEqual(expect.arrayContaining([expect.objectContaining({ loc: ['body', 'days_of_week', 0], msg: expect.any(String), type: expect.any(String) })]));
    expect((await call('GET', '/invalid-id')).statusCode).toBe(422);
    const activity = await create(); const result = await call('GET', `/${activity.id}/logs?from=invalid`); expect(result.json()).toEqual({ detail: 'Use an ISO date or timestamp for log bounds' });
    const schedule = await call('PATCH', `/${activity.id}`, { frequency: 'weekly' }); expect(schedule.statusCode).toBe(422); expect(schedule.json().detail).toEqual(expect.arrayContaining([expect.objectContaining({ msg: 'Weekly and custom schedules require days_of_week' })]));
  });
});
