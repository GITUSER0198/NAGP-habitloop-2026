import * as crypto from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { createApp, getPool, signToken } from '@habitloop/shared';
import { initializeChallengeTables } from '../src/db/init.js';
import { registerChallengeRoutes } from '../src/routes/challenges.js';

describe('Challenge contract details', () => {
  const prefix = '/api/challenges'; const tenant = crypto.randomUUID(); const owner = crypto.randomUUID(); const peer = crypto.randomUUID(); const foreignTenant = crypto.randomUUID(); const foreignUser = crypto.randomUUID();
  let app: FastifyInstance; let auth: Record<string, string>; let peerAuth: Record<string, string>; let foreign: Record<string, string>;
  const secret = { 'x-internal-token': process.env.INTERNAL_TOKEN! };
  const call = (method: InjectOptions['method'], path = '', payload?: unknown, headers = auth) => app.inject({ method, url: prefix + path, headers: { ...headers, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) }, ...(payload === undefined ? {} : { payload: payload as object }) });
  async function create(changes: Record<string, unknown> = {}, headers = auth) {
    const result = await call('POST', '', { title: ' Run ', activity_category: ' fitness ', start_date: '2026-11-01', end_date: '2026-12-01', target_count: 10, ...changes }, headers);
    expect(result.statusCode, result.body).toBe(201); return result.json();
  }
  const ids = (items: { id: string }[]) => items.map(item => item.id);
  async function setTime(value: string) {
    vi.setSystemTime(new Date(value));
    const token = async (sub: string, tenant_id: string) => ({ authorization: `Bearer ${await signToken({ sub, tenant_id, email: 'test@example.com', name: 'Test' })}` });
    auth = await token(owner, tenant); peerAuth = await token(peer, tenant); foreign = await token(foreignUser, foreignTenant);
  }
  beforeAll(async () => {
    app = await createApp('challenge-service', prefix); await app.register(registerChallengeRoutes, { prefix }); await app.ready(); await initializeChallengeTables();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM "challenges_test"."participants"'); await getPool().query('DELETE FROM "challenges_test"."challenges"');
    vi.useFakeTimers({ toFake: ['Date'] }); await setTime('2026-11-21T12:00:00Z');
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  afterAll(async () => { await app.close(); });

  it('normalizes creation fields, defaults to public and scopes feeds by tenant', async () => {
    const created = await create();
    expect(created).toEqual({ id: created.id, tenant_id: tenant, owner_id: owner, title: 'Run', description: '', visibility: 'public', activity_category: 'fitness', start_date: '2026-11-01', end_date: '2026-12-01', target_count: 10 });
    expect(ids((await call('GET', '/feed')).json())).toEqual([created.id]);
    expect((await call('GET', '/feed', undefined, foreign)).json()).toEqual([]);
    expect((await call('GET', `/${created.id}`, undefined, foreign)).statusCode).toBe(404);
  });
  it('orders the feed newest start date first', async () => {
    const older = await create({ title: 'Older', start_date: '2026-10-01' }); const newer = await create({ title: 'Newer', start_date: '2026-11-10' });
    expect(ids((await call('GET', '/feed')).json())).toEqual([newer.id, older.id]);
  });
  it('isolates join and leave across tenants for both visibilities', async () => {
    for (const visibility of ['public', 'members']) {
      const challenge = await create({ visibility });
      expect((await call('POST', `/${challenge.id}/leave`, undefined, foreign)).statusCode).toBe(404);
      expect((await call('POST', `/${challenge.id}/join`, undefined, foreign)).statusCode).toBe(visibility === 'public' ? 409 : 404);
    }
  });
  it('filters internal active challenges by dates, category, membership and tenant', async () => {
    const active = await create({ start_date: '2026-11-21', end_date: '2026-11-21' }); const mind = await create({ activity_category: 'mind' });
    await create({ start_date: '2026-11-22' }); await create({ start_date: '2026-11-19', end_date: '2026-11-20' });
    const path = `/internal/users/${owner}/active`; const headers = { ...auth, ...secret };
    expect((await call('GET', path, undefined, headers)).json().sort()).toEqual([active.id, mind.id].sort());
    expect((await call('GET', `${path}?category=fitness`, undefined, headers)).json()).toEqual([active.id]); expect((await call('GET', `${path}?category=missing`, undefined, headers)).json()).toEqual([]);
    const peerPath = `/internal/users/${peer}/active`;
    expect((await call('GET', peerPath, undefined, headers)).json()).toEqual([]);
    await call('POST', `/${active.id}/join`, undefined, peerAuth); expect((await call('GET', peerPath, undefined, headers)).json()).toEqual([active.id]);
    await call('POST', `/${active.id}/leave`, undefined, peerAuth); expect((await call('GET', peerPath, undefined, headers)).json()).toEqual([]);
    for (const invalid of [auth, secret, { ...auth, 'x-internal-token': 'invalid' }]) expect((await call('GET', path, undefined, invalid)).statusCode).toBe(401);
  });
  it.each([{ title: ' ' }, { visibility: 'private' }, { visibility: 'secret' }, { activity_category: ' ' }, { target_count: 0 }, { target_count: true }, { start_date: 'invalid' }, { start_date: '2030-01-02', end_date: '2030-01-01' }, { tenant_id: tenant }, { invite_code: 'ABCDEFGH' }])('rejects invalid creation %j', async changes => {
    expect((await call('POST', '', { title: 'Run', activity_category: 'fitness', start_date: '2030-01-01', end_date: '2030-01-02', target_count: 1, ...changes })).statusCode).toBe(422);
  });
  it('requires authentication on every route before validation', async () => {
    const challenge = await create();
    for (const path of ['/feed', `/${challenge.id}`, `/public/${tenant}`]) expect((await call('GET', path, undefined, {})).statusCode).toBe(401);
    for (const [path, body] of [['', {}], [`/${challenge.id}/join`, undefined], [`/${challenge.id}/leave`, undefined]] as const) expect((await call('POST', path, body, {})).statusCode).toBe(401);
  });
  it('accepts the gateway collection slash', async () => {
    expect((await call('POST', '/', { title: 'Run', activity_category: 'fitness', start_date: '2026-11-21', end_date: '2026-11-21', target_count: 1 })).statusCode).toBe(201);
  });
  it('serves both health paths, request ids and documentation', async () => {
    for (const path of ['/health', `${prefix}/health`]) { const result = await app.inject(path); expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ status: 'ok', service: 'challenge-service' }); expect(result.headers['x-request-id']).toBeTruthy(); }
    for (const path of ['/docs', `${prefix}/docs`, `${prefix}/openapi.json`]) expect((await app.inject(path)).statusCode).toBe(200);
  });
  it('returns validation lists for malformed paths', async () => {
    const path = await call('GET', '/invalid-id'); expect(path.statusCode).toBe(422); expect(path.json().detail[0].loc).toEqual(['path', 'id']);
  });
});
