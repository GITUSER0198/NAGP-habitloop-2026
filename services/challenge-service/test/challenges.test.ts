import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp, getPool, signToken } from '@habitloop/shared';
import { initializeChallengeTables } from '../src/db/init.js';
import { registerChallengeRoutes } from '../src/routes/challenges.js';

describe('Challenge Service HTTP contract', () => {
  let app: FastifyInstance;
  const tenant = '11111111-1111-4111-8111-111111111111';
  const otherTenant = '33333333-3333-4333-8333-333333333333';
  const owner = '22222222-2222-4222-8222-222222222222';
  const member = '44444444-4444-4444-8444-444444444444';
  let ownerToken: string; let memberToken: string; let outsiderToken: string;
  beforeAll(async () => {
    app = await createApp('challenge-service-test', '/api/challenges');
    await app.register(async service => registerChallengeRoutes(service), { prefix: '/api/challenges' }); await app.ready(); await initializeChallengeTables();
    ownerToken = await signToken({ sub: owner, tenant_id: tenant, email: 'owner@example.com', name: 'Owner' });
    memberToken = await signToken({ sub: member, tenant_id: tenant, email: 'friend@example.com', name: 'Friend' });
    outsiderToken = await signToken({ sub: member, tenant_id: otherTenant, email: 'friend@example.com', name: 'Friend' });
  });
  beforeEach(async () => {
    for (const table of ['posts', 'participants', 'challenges']) await getPool().query(`DELETE FROM "challenges_test"."${table}"`);
  });
  afterAll(async () => { await app.close(); });
  const auth = (token = ownerToken) => ({ authorization: `Bearer ${token}` });
  async function create(visibility: 'public' | 'members' = 'public', end_date = '2026-12-31', title = 'Move more') {
    const start_date = end_date < '2026-11-01' ? '2019-12-01' : '2026-11-01';
    return app.inject({ method: 'POST', url: '/api/challenges', headers: auth(), payload: { title, visibility, activity_category: 'fitness', start_date, end_date, target_count: 10 } });
  }
  const call = (method: 'GET' | 'POST', url: string, token = ownerToken) => app.inject({ method, url: `/api/challenges${url}`, headers: auth(token) });

  it('creates challenges in the active community with a wall post, and exposes no invite code', async () => {
    const created = await create('members');
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ tenant_id: tenant, owner_id: owner, visibility: 'members' });
    expect(created.json()).not.toHaveProperty('invite_code');
    expect((await getPool().query('SELECT 1 FROM "challenges_test"."posts"')).rows).toHaveLength(1);
    const legacy = await app.inject({ method: 'POST', url: '/api/challenges', headers: auth(), payload: { title: 'x', visibility: 'private', activity_category: 'fitness', start_date: '2026-11-01', end_date: '2026-12-01', target_count: 1 } });
    expect(legacy.statusCode).toBe(422);
  });
  it('removes the invite and join-by-code routes', async () => {
    const id = (await create()).json().id;
    expect((await app.inject({ method: 'POST', url: '/api/challenges/join-by-code', headers: auth(), payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/challenges/${id}/invites`, headers: auth(), payload: {} })).statusCode).toBe(404);
  });
  it('lets every community member see and join public and members-only challenges', async () => {
    const older = (await create('public', '2026-12-31', 'Older')).json();
    const open = (await create('members', '2026-12-31', 'Members')).json();
    const feed = (await call('GET', '/feed', memberToken)).json() as { id: string }[];
    expect(feed.map(row => row.id).sort()).toEqual([older.id, open.id].sort());
    for (const id of [older.id, open.id]) {
      expect((await call('GET', `/${id}`, memberToken)).statusCode).toBe(200);
      expect((await call('POST', `/${id}/join`, memberToken)).statusCode).toBe(200);
    }
  });
  it('shows public challenges to other communities but requires joining the community first', async () => {
    const pub = (await create('public')).json(); const hidden = (await create('members')).json();
    const listed = (await call('GET', `/public/${tenant}`, outsiderToken)).json() as { id: string }[];
    expect(listed.map(row => row.id)).toEqual([pub.id]);
    const blocked = await call('POST', `/${pub.id}/join`, outsiderToken);
    expect(blocked.statusCode).toBe(409); expect(blocked.json().detail).toBe('Join the community first');
    expect((await call('POST', `/${hidden.id}/join`, outsiderToken)).statusCode).toBe(404);
    expect((await call('GET', `/${hidden.id}`, outsiderToken)).statusCode).toBe(404);
    expect((await call('GET', '/feed', outsiderToken)).json()).toEqual([]);
  });
  it('rejects joining after the end date and leaves cleanly', async () => {
    const expired = await create('public', '2020-01-01');
    expect((await call('POST', `/${expired.json().id}/join`, memberToken)).statusCode).toBe(409);
    const active = (await create()).json();
    expect((await call('POST', `/${active.id}/join`, memberToken)).json().status).toBe('joined');
    expect((await call('POST', `/${active.id}/leave`, memberToken)).json().status).toBe('left');
  });
  it('requires authentication', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/challenges/feed' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/challenges/public/${tenant}` })).statusCode).toBe(401);
  });
});
