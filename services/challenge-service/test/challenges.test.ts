import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp, getPool, signToken } from '@habitloop/shared';
import { initializeChallengeTables } from '../src/db/init.js';
import { registerChallengeRoutes } from '../src/routes/challenges.js';

describe('Challenge Service HTTP contract', () => {
  let app: FastifyInstance;
  const tenant = '11111111-1111-4111-8111-111111111111';
  const otherTenant = '33333333-3333-4333-8333-333333333333';
  const owner = '22222222-2222-4222-8222-222222222222';
  const invited = '44444444-4444-4444-8444-444444444444';
  let ownerToken: string; let invitedToken: string;
  beforeAll(async () => {
    app = await createApp('challenge-service-test', '/api/challenges');
    await app.register(async service => registerChallengeRoutes(service), { prefix: '/api/challenges' }); await app.ready(); await initializeChallengeTables();
    ownerToken = await signToken({ sub: owner, tenant_id: tenant, email: 'owner@example.com', name: 'Owner' });
    invitedToken = await signToken({ sub: invited, tenant_id: tenant, email: 'friend@example.com', name: 'Friend' });
  });
  beforeEach(async () => { await getPool().query('DELETE FROM "challenges_test"."participants"'); await getPool().query('DELETE FROM "challenges_test"."challenges"'); });
  afterAll(async () => { await app.close(); });
  const auth = (token = ownerToken) => ({ authorization: `Bearer ${token}` });
  async function create(visibility: 'public' | 'private' = 'public', end_date = '2026-12-31') {
    const start_date = end_date < '2026-11-01' ? '2019-12-01' : '2026-11-01';
    return app.inject({ method: 'POST', url: '/api/challenges', headers: auth(), payload: { title: 'Move more', visibility, activity_category: 'fitness', start_date, end_date, target_count: 10 } });
  }
  it('hides private challenges from outsiders and scopes challenge ids by tenant', async () => {
    const created = await create('private'); const id = created.json().id;
    expect((await app.inject({ method: 'GET', url: `/api/challenges/${id}`, headers: auth(invitedToken) })).statusCode).toBe(404);
    const foreign = await signToken({ sub: owner, tenant_id: otherTenant, email: 'owner@example.com', name: 'Owner' });
    expect((await app.inject({ method: 'GET', url: `/api/challenges/${id}`, headers: auth(foreign) })).statusCode).toBe(404);
  });
  it('invites by email, joins by code, and accepts an invite twice', async () => {
    const created = await create('private'); const challenge = created.json();
    const lookup = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.includes('email=')) return new Response(JSON.stringify({ id: invited, tenant_id: tenant }), { status: 200 });
      return new Response(JSON.stringify({ id: invited, tenant_id: tenant }), { status: 200 });
    });
    try {
      const response = await app.inject({ method: 'POST', url: `/api/challenges/${challenge.id}/invites`, headers: auth(), payload: { emails: ['friend@example.com'] } });
      expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ invite_code: challenge.invite_code, user_ids: [invited] });
      expect((await app.inject({ method: 'GET', url: '/api/challenges/invites', headers: auth(invitedToken) })).json()).toHaveLength(1);
      const accepted = await app.inject({ method: 'POST', url: `/api/challenges/invites/${challenge.id}/accept`, headers: auth(invitedToken) });
      const again = await app.inject({ method: 'POST', url: `/api/challenges/invites/${challenge.id}/accept`, headers: auth(invitedToken) });
      expect(accepted.statusCode).toBe(200); expect(again.statusCode).toBe(200); expect(again.json().status).toBe('joined');
      expect((await app.inject({ method: 'GET', url: `/api/challenges/${challenge.id}`, headers: auth(invitedToken) })).statusCode).toBe(200);
    } finally { lookup.mockRestore(); }
  });
  it('rejects joining after end date and joins a tenant-local code', async () => {
    const expired = await create('public', '2020-01-01');
    expect((await app.inject({ method: 'POST', url: `/api/challenges/${expired.json().id}/join`, headers: auth(invitedToken) })).statusCode).toBe(409);
    const active = await create('public');
    expect((await app.inject({ method: 'POST', url: '/api/challenges/join-by-code', headers: auth(invitedToken), payload: { invite_code: active.json().invite_code } })).statusCode).toBe(200);
    const foreign = await signToken({ sub: invited, tenant_id: otherTenant, email: 'friend@example.com', name: 'Friend' });
    expect((await app.inject({ method: 'POST', url: '/api/challenges/join-by-code', headers: auth(foreign), payload: { invite_code: active.json().invite_code } })).statusCode).toBe(404);
  });
});
