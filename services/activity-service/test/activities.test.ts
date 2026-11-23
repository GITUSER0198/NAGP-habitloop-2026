import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp, getPool, signToken } from '@habitloop/shared';
import { initializeActivityTables } from '../src/db/init.js';
import { registerActivityRoutes } from '../src/routes/activities.js';

describe('Activity Service HTTP contract', () => {
  let app: FastifyInstance;
  const tenant = '11111111-1111-4111-8111-111111111111';
  const user = '22222222-2222-4222-8222-222222222222';
  const otherTenant = '33333333-3333-4333-8333-333333333333';
  let token: string;
  beforeAll(async () => {
    app = await createApp('activity-service-test', '/api/activities');
    await app.register(async service => registerActivityRoutes(service), { prefix: '/api/activities' }); await app.ready(); await initializeActivityTables();
    token = await signToken({ sub: user, tenant_id: tenant, email: 'alex@example.com', name: 'Alex' });
  });
  beforeEach(async () => { await getPool().query('DELETE FROM "activities_test"."activity_logs"'); await getPool().query('DELETE FROM "activities_test"."activities"'); });
  afterAll(async () => { await app.close(); });
  const auth = () => ({ authorization: `Bearer ${token}` });
  async function create(payload: Record<string, unknown> = {}) {
    return app.inject({ method: 'POST', url: '/api/activities', headers: auth(), payload: { name: 'Walk', category: 'fitness', ...payload } });
  }
  it('creates, validates, patches, lists, and soft deletes activities', async () => {
    expect((await create({ preferred_time: '25:00' })).statusCode).toBe(422);
    expect((await create({ frequency: 'weekly' })).statusCode).toBe(422);
    expect((await create({ category: 'unknown' })).statusCode).toBe(422);
    const created = await create({ frequency: 'weekly', days_of_week: [1, 3], preferred_time: '07:15' }); expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect((await app.inject({ method: 'GET', url: '/api/activities/categories', headers: auth() })).json().fitness).toBe('ti-run');
    expect((await app.inject({ method: 'GET', url: '/api/activities', headers: auth() })).json()).toHaveLength(1);
    expect((await app.inject({ method: 'PATCH', url: `/api/activities/${id}`, headers: auth(), payload: { days_of_week: [] } })).statusCode).toBe(422);
    expect((await app.inject({ method: 'DELETE', url: `/api/activities/${id}`, headers: auth() })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/activities', headers: auth() })).json()).toHaveLength(0);
    expect((await getPool().query('SELECT id FROM "activities_test"."activities"')).rows).toHaveLength(1);
  });
  it('tenant-scopes ids and log history', async () => {
    const created = await create(); const id = created.json().id;
    const foreignToken = await signToken({ sub: user, tenant_id: otherTenant, email: 'alex@example.com', name: 'Alex' });
    expect((await app.inject({ method: 'GET', url: `/api/activities/${id}`, headers: { authorization: `Bearer ${foreignToken}` } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/activities/${id}/logs`, headers: { authorization: `Bearer ${foreignToken}` }, payload: { status: 'done' } })).statusCode).toBe(404);
  });
  it('uses the user timezone for due_at and supports internal schedule and log reads', async () => {
    const created = await create({ preferred_time: '07:15' }); const id = created.json().id;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      if (String(input).includes('/api/users/internal/users/')) return new Response(JSON.stringify({ timezone: 'Asia/Kolkata' }), { status: 200 });
      return new Response(null, { status: 202 });
    });
    try {
      const today = await app.inject({ method: 'GET', url: '/api/activities/today', headers: auth() });
      expect(today.statusCode).toBe(200); expect(today.json()[0].due_at).toMatch(/T07:15:00\+05:30$/);
      const internalHeaders = { ...auth(), 'x-internal-token': process.env.INTERNAL_TOKEN! };
      expect((await app.inject({ method: 'PATCH', url: `/api/activities/internal/${id}/schedule`, headers: internalHeaders, payload: { frequency: 'weekly' } })).statusCode).toBe(422);
      expect((await app.inject({ method: 'PATCH', url: `/api/activities/internal/${id}/schedule`, headers: internalHeaders, payload: { days_of_week: [1, 3], preferred_time: '08:00' } })).statusCode).toBe(200);
      const logged = await app.inject({ method: 'POST', url: `/api/activities/${id}/logs`, headers: auth(), payload: { status: 'done' } });
      expect(logged.statusCode).toBe(201);
      const logs = await app.inject({ method: 'GET', url: `/api/activities/internal/users/${user}/logs?since=2000-01-01T00:00:00Z`, headers: internalHeaders });
      expect(logs.statusCode).toBe(200); expect(logs.json()).toHaveLength(1);
    } finally { fetch.mockRestore(); }
  });
  it('idempotently accepts partner log replays and publishes challenge IDs', async () => {
    const created = await create(); const id = created.json().id;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.includes('/active')) return new Response(JSON.stringify(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']), { status: 200 });
      return new Response(null, { status: 202 });
    });
    try {
      const payload = { tenant_id: tenant, user_id: user, activity_id: id, status: 'done', logged_at: '2026-11-21T08:00:00Z', source: 'partner', source_event_id: 'evt-1', metadata: { provider: 'test' } };
      const first = await app.inject({ method: 'POST', url: '/api/activities/internal/logs', headers: { ...auth(), 'x-internal-token': process.env.INTERNAL_TOKEN! }, payload });
      expect(first.statusCode).toBe(201); expect(first.json().metadata).toEqual({ provider: 'test' });
      const eventRequest = fetch.mock.calls.find(call => String(call[0]).endsWith('/events'))!;
      expect(JSON.parse(eventRequest[1]!.body as string).detail.challenge_ids).toEqual(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
      const replay = await app.inject({ method: 'POST', url: '/api/activities/internal/logs', headers: { ...auth(), 'x-internal-token': process.env.INTERNAL_TOKEN! }, payload });
      expect(replay.statusCode).toBe(200); expect(replay.json()).toEqual({ duplicate: true });
      expect((await getPool().query('SELECT id FROM "activities_test"."activity_logs"')).rows).toHaveLength(1);
    } finally { fetch.mockRestore(); }
  });
  it('deletes a partner log by source event, publishes ActivityLogDeleted once, and is tenant-scoped', async () => {
    const id = (await create()).json().id; const internal = { 'x-internal-token': process.env.INTERNAL_TOKEN! };
    const challenge = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).includes('/active') ? new Response(JSON.stringify([challenge]), { status: 200 }) : new Response(null, { status: 202 }));
    try {
      const payload = { tenant_id: tenant, user_id: user, activity_id: id, status: 'done', logged_at: '2026-11-21T08:00:00Z', source: 'partner', source_event_id: 'evt-del', metadata: {} };
      const created = await app.inject({ method: 'POST', url: '/api/activities/internal/logs', headers: { ...auth(), ...internal }, payload });
      const logId = created.json().id;
      expect((await app.inject({ method: 'DELETE', url: `/api/activities/internal/logs/by-source/evt-del?tenant_id=${tenant}` })).statusCode).toBe(401);
      expect((await app.inject({ method: 'DELETE', url: `/api/activities/internal/logs/by-source/evt-del?tenant_id=${otherTenant}`, headers: internal })).statusCode).toBe(404);
      expect((await getPool().query('SELECT id FROM "activities_test"."activity_logs"')).rows).toHaveLength(1);
      const removed = await app.inject({ method: 'DELETE', url: `/api/activities/internal/logs/by-source/evt-del?tenant_id=${tenant}`, headers: internal });
      expect(removed.statusCode).toBe(204);
      expect((await getPool().query('SELECT id FROM "activities_test"."activity_logs"')).rows).toHaveLength(0);
      const deletedEvents = fetch.mock.calls.filter(call => String(call[1]?.body ?? '').includes('ActivityLogDeleted'));
      expect(deletedEvents).toHaveLength(1);
      expect(JSON.parse(deletedEvents[0]![1]!.body as string).detail).toEqual({ tenant_id: tenant, user_id: user, activity_id: id, log_id: logId, status: 'done',
        logged_at: '2026-11-21T08:00:00+00:00', challenge_ids: [challenge] });
      expect((await app.inject({ method: 'DELETE', url: `/api/activities/internal/logs/by-source/evt-del?tenant_id=${tenant}`, headers: internal })).statusCode).toBe(404);
    } finally { fetch.mockRestore(); }
  });
});
