import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp, getPool, signToken } from '@habitloop/shared';
import { initializeIntegrationTables } from '../src/db/init.js';
import { registerRawBodyParser } from '../src/raw-body.js';
import { registerIntegrationRoutes } from '../src/routes/integrations.js';
import { createHash, createHmac } from 'node:crypto';

describe('Integration Service HTTP contract parity (22 Python cases)', () => {
  let app: FastifyInstance;
  const tenant = '11111111-1111-4111-8111-111111111111'; const user = '22222222-2222-4222-8222-222222222222';
  const otherTenant = '33333333-3333-4333-8333-333333333333'; const activity = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  let token: string;
  beforeAll(async () => {
    app = await createApp('integration-service-test', '/api/integrations');
    registerRawBodyParser(app);
    await app.register(async instance => registerIntegrationRoutes(instance), { prefix: '/api/integrations' });
    await app.ready(); await initializeIntegrationTables(); token = await signToken({ sub: user, tenant_id: tenant, email: 'test@example.com', name: 'Tester' });
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM "integrations_test".partner_events'); await getPool().query('DELETE FROM "integrations_test".links');
    vi.restoreAllMocks(); vi.spyOn(globalThis, 'fetch').mockImplementation(async url => String(url).includes('/api/activities/') ? new Response('{}', { status: 200 }) : new Response('{}', { status: 200 }));
  });
  afterAll(async () => app.close());
  const auth = (value = token) => ({ authorization: `Bearer ${value}` });
  async function create(provider = 'mockfit', activity_map: Record<string, string> = { run: activity }) {
    return app.inject({ method: 'POST', url: '/api/integrations/links', headers: auth(), payload: { provider, activity_map } });
  }
  const workout = (change: Record<string, unknown> = {}) => ({ event_id: 'event-one', type: 'workout', provider_activity: 'run', started_at: '2026-11-19T09:00:00+05:30', duration_min: 25, steps: 5500, ...change });
  async function send(link: { id: string; ingest_key: string }, data: Record<string, unknown> = workout(), bodyText?: string, sig?: string) {
    const raw = bodyText ?? JSON.stringify(data);
    const signature = sig ?? `sha256=${createHmac('sha256', link.ingest_key).update(raw).digest('hex')}`;
    return app.inject({ method: 'POST', url: `/api/integrations/ingest/${link.id}`, headers: { 'content-type': 'application/json', 'x-habitloop-signature': signature }, payload: raw });
  }
  it('lists providers, discloses the key once, hashes it, and soft deletes tenant links', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/integrations/providers', headers: auth() })).json().map((item: { provider: string }) => item.provider)).toEqual(['mockfit', 'mockrun', 'galaxywatch']);
    const created = await create(); expect(created.statusCode).toBe(201); const link = created.json();
    expect(link.tenant_id).toBe(tenant); expect(link.user_id).toBe(user); expect(link.ingest_key).toBeTruthy();
    const stored = (await getPool().query('SELECT ingest_key_hash FROM "integrations_test".links WHERE id=$1', [link.id])).rows[0];
    expect(stored.ingest_key_hash).not.toBe(link.ingest_key); expect(stored.ingest_key_hash).toHaveLength(64);
    const listed = await app.inject({ method: 'GET', url: '/api/integrations/links', headers: auth() });
    expect(listed.json()).toHaveLength(1); expect(listed.json()[0]).not.toHaveProperty('ingest_key'); expect(listed.json()[0]).not.toHaveProperty('ingest_key_hash');
    expect((await app.inject({ method: 'DELETE', url: `/api/integrations/links/${link.id}`, headers: auth() })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/integrations/links', headers: auth() })).json()).toEqual([]);
    expect((await send(link)).statusCode).toBe(404); expect((await app.inject({ method: 'DELETE', url: `/api/integrations/links/${link.id}`, headers: auth() })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/integrations/links/${link.id}/events`, headers: auth() })).statusCode).toBe(404);
  });
  it('stores and publishes once; replay IDs are link-scoped and return the duplicate shape', async () => {
    const link = (await create()).json(); const eventFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const first = await send(link); expect(first.statusCode).toBe(202); expect(first.json()).toMatchObject({ status: 'received' });
    expect(eventFetch).toHaveBeenCalledTimes(1); expect(JSON.parse(String(eventFetch.mock.calls[0][1]?.body)).detail).toMatchObject({ tenant_id: tenant, user_id: user, link_id: link.id, provider: 'mockfit', raw: workout() });
    expect((await send(link)).json()).toEqual({ duplicate: true }); expect((await send(link)).json()).toEqual({ duplicate: true });
    expect(eventFetch.mock.calls.filter(call => String(call[0]).endsWith('/events'))).toHaveLength(1);
    expect((await getPool().query('SELECT id FROM "integrations_test".partner_events')).rows).toHaveLength(1);
    const second = (await create('mockrun')).json(); expect((await send(second)).statusCode).toBe(202);
    expect(eventFetch.mock.calls.filter(call => String(call[0]).endsWith('/events'))).toHaveLength(2);
    const watchLink = (await create('galaxywatch', { walk: activity, run: activity, cycle: activity, steps: activity })).json();
    expect(watchLink.provider).toBe('galaxywatch');
    const stepsPayload = { event_id: 'steps-1', type: 'steps', provider_activity: 'steps', started_at: '2026-11-19T09:00:00Z', steps: 6000, avg_heart_rate: 110 };
    const stepsRes = await send(watchLink, stepsPayload);
    expect(stepsRes.statusCode).toBe(202);
    expect(eventFetch.mock.calls.filter(call => String(call[0]).endsWith('/events'))).toHaveLength(3);
  });
  it.each([undefined, 'sha256=bad', `sha256=${'0'.repeat(64)}`, 'sha256=é'])('rejects bad signature %s without storing or publishing', async signature => {
    const link = (await create()).json(); const headers: Record<string, string> = { 'content-type': 'application/json' }; if (signature !== undefined) headers['x-habitloop-signature'] = signature;
    const response = await app.inject({ method: 'POST', url: `/api/integrations/ingest/${link.id}`, headers, payload: '{}' });
    expect(response.statusCode).toBe(401); expect((await getPool().query('SELECT id FROM "integrations_test".partner_events')).rows).toHaveLength(0);
    expect(vi.mocked(fetch).mock.calls.filter(call => String(call[0]).endsWith('/events'))).toHaveLength(0);
  });
  it('signs exact bytes and rejects whitespace changes', async () => {
    const link = (await create()).json(); const exactBody = workout({ event_id: `exact-${(await import('node:crypto')).randomUUID()}` }); const raw = JSON.stringify(exactBody); const { createHmac } = await import('node:crypto');
    const signature = `sha256=${createHmac('sha256', link.ingest_key).update(raw).digest('hex')}`;
    const base = await new Promise<string>(resolve => app.server.listen(0, '127.0.0.1', () => {
      const address = app.server.address(); if (address && typeof address !== 'string') resolve(`http://127.0.0.1:${address.port}`);
    }));
    vi.restoreAllMocks();
    const response = await fetch(`${base}/api/integrations/ingest/${link.id}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-habitloop-signature': signature }, body: `${raw} ` });
    expect(response.status).toBe(401);
    await new Promise<void>((resolve, reject) => app.server.close(error => error ? reject(error) : resolve()));
  });
  it.each([{ type: 'sleep' }, { started_at: '2026-11-19T09:00:00' }, { started_at: 'bad' }, { duration_min: -1 }, { duration_min: true }, { steps: -1 }, { steps: 1.5 }, { event_id: '' }, { event_id: 'x'.repeat(256) }])('rejects signed invalid payload $type $started_at $duration_min $steps $event_id', async change => {
    const link = (await create()).json(); expect((await send(link, workout(change))).statusCode).toBe(422);
    expect((await getPool().query('SELECT id FROM "integrations_test".partner_events')).rows).toHaveLength(0);
    expect(vi.mocked(fetch).mock.calls.filter(call => String(call[0]).endsWith('/events'))).toHaveLength(0);
  });
  it('hides links and event status from other tenants and peer users', async () => {
    const link = (await create()).json(); const event = (await send(link)).json();
    for (const tenant_id of [tenant, otherTenant]) {
      const outsider = await signToken({ sub: '44444444-4444-4444-8444-444444444444', tenant_id, email: 'other@example.com', name: 'Other' });
      expect((await app.inject({ method: 'GET', url: '/api/integrations/links', headers: auth(outsider) })).json()).toEqual([]);
      expect((await app.inject({ method: 'DELETE', url: `/api/integrations/links/${link.id}`, headers: auth(outsider) })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: `/api/integrations/links/${link.id}/events`, headers: auth(outsider) })).statusCode).toBe(404);
      expect((await app.inject({ method: 'PATCH', url: `/api/integrations/internal/events/${event.id}`, headers: { ...auth(outsider), 'x-internal-token': process.env.INTERNAL_TOKEN! }, payload: { status: 'normalized' } })).statusCode).toBe(404);
    }
  });
  it('requires both internal and user auth, updates reason idempotently, and returns 404 for missing event', async () => {
    const link = (await create()).json(); const event = (await send(link, workout({ provider_activity: 'yoga' }))).json(); const path = `/api/integrations/internal/events/${event.id}`;
    expect((await app.inject({ method: 'PATCH', url: path, headers: auth(), payload: { status: 'rejected', reason: 'Unmapped provider activity: yoga' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PATCH', url: path, headers: { 'x-internal-token': process.env.INTERNAL_TOKEN! }, payload: { status: 'rejected' } })).statusCode).toBe(401);
    const internal = { ...auth(), 'x-internal-token': process.env.INTERNAL_TOKEN! };
    expect((await app.inject({ method: 'PATCH', url: path, headers: internal, payload: { status: 'rejected' } })).statusCode).toBe(200);
    for (let i = 0; i < 2; i++) expect((await app.inject({ method: 'PATCH', url: path, headers: internal, payload: { status: 'rejected', reason: 'Unmapped provider activity: yoga' } })).json().reason).toBe('Unmapped provider activity: yoga');
    const listed = await app.inject({ method: 'GET', url: `/api/integrations/links/${link.id}/events`, headers: auth() }); expect(listed.json()[0]).toMatchObject({ status: 'rejected', reason: 'Unmapped provider activity: yoga' });
    expect((await app.inject({ method: 'PATCH', url: path, headers: internal, payload: { status: 'normalized' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/api/integrations/internal/events/99999999-9999-4999-8999-999999999999`, headers: internal, payload: { status: 'rejected' } })).statusCode).toBe(404);
  });
  it('returns only the newest 50 event records', async () => {
    const link = (await create()).json();
    for (let i = 0; i < 55; i++) await getPool().query('INSERT INTO "integrations_test".partner_events (id,tenant_id,link_id,event_id,payload,received_at) VALUES ($1,$2,$3,$4,$5,$6)', [`00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, tenant, link.id, String(i), JSON.stringify(workout()), new Date(Date.now() + i * 1000)]);
    const result = await app.inject({ method: 'GET', url: `/api/integrations/links/${link.id}/events`, headers: auth() }); expect(result.json().map((row: { event_id: string }) => row.event_id)).toEqual(Array.from({ length: 50 }, (_, index) => String(54 - index)));
  });
  it('commits the event before local dispatch', async () => {
    const link = (await create()).json();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      const data = JSON.parse(String(options?.body)); const response = await app.inject({ method: 'PATCH', url: `/api/integrations/internal/events/${data.detail.partner_event_id}`, headers: { ...auth(), 'x-internal-token': process.env.INTERNAL_TOKEN! }, payload: { status: 'normalized' } });
      expect(response.statusCode).toBe(200); return new Response('', { status: 200 });
    });
    expect((await send(link)).statusCode).toBe(202);
    expect((await app.inject({ method: 'GET', url: `/api/integrations/links/${link.id}/events`, headers: auth() })).json()[0].status).toBe('normalized');
  });
  it('validates providers and maps, authenticates routes, and maps downstream errors', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/integrations/providers' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/integrations/links' })).statusCode).toBe(401);
    for (const body of [{ provider: 'unknown', activity_map: {} }, { provider: 'mockrun', activity_map: { swim: activity } }, { provider: 'mockfit', activity_map: { run: 'not-a-uuid' } }])
      expect((await app.inject({ method: 'POST', url: '/api/integrations/links', headers: auth(), payload: body })).statusCode).toBe(422);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 404 }));
    expect((await create()).statusCode).toBe(422);
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    expect((await create()).statusCode).toBe(502);
    expect((await create('mockfit', {})).json().activity_map).toEqual({});
  });
  it('serves service health and documentation routes', async () => {
    for (const path of ['/health', '/api/integrations/health']) expect((await app.inject({ url: path })).json()).toEqual({ status: 'ok', service: 'integration-service-test' });
    expect((await app.inject({ url: '/docs' })).statusCode).toBe(200); expect((await app.inject({ url: '/api/integrations/docs' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/integrations/openapi.json' })).statusCode).toBe(200);
  });
  it('matches complete provider, link, accepted event, event list, and PATCH JSON shapes', async () => {
    const providers = await app.inject({ url: '/api/integrations/providers', headers: auth() });
    expect(providers.statusCode).toBe(200);
    expect(providers.json()).toEqual([
      { provider: 'mockfit', activity_types: ['run', 'walk', 'cycle', 'swim'] },
      { provider: 'mockrun', activity_types: ['run', 'walk'] },
      { provider: 'galaxywatch', activity_types: ['walk', 'run', 'cycle', 'steps'] }
    ]);
    const created = await create(); expect(created.statusCode).toBe(201);
    const link = created.json();
    expect(link).toEqual({ id: expect.any(String), tenant_id: tenant, user_id: user, provider: 'mockfit', status: 'active',
      activity_map: { run: activity }, created_at: expect.any(String), ingest_key: expect.any(String) });
    const stored = (await getPool().query('SELECT ingest_key_hash FROM "integrations_test".links WHERE id=$1', [link.id])).rows[0];
    expect(stored.ingest_key_hash).toBe(createHash('sha256').update(link.ingest_key).digest('hex'));
    expect(Buffer.byteLength(link.ingest_key)).toBeGreaterThan(64);
    const { ingest_key: key, ...publicLink } = link; expect(key).toBeTruthy();
    const listed = await app.inject({ url: '/api/integrations/links', headers: auth() });
    expect(listed.statusCode).toBe(200); expect(listed.json()).toEqual([publicLink]);
    const accepted = await send(link); expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({ id: expect.any(String), status: 'received' });
    const events = await app.inject({ url: `/api/integrations/links/${link.id}/events`, headers: auth() });
    expect(events.statusCode).toBe(200);
    const expectedEvent = { id: accepted.json().id, tenant_id: tenant, link_id: link.id, event_id: 'event-one',
      payload: workout(), status: 'received', reason: null, received_at: expect.any(String) };
    expect(events.json()).toEqual([expectedEvent]);
    const patched = await app.inject({ method: 'PATCH', url: `/api/integrations/internal/events/${accepted.json().id}`,
      headers: { ...auth(), 'x-internal-token': process.env.INTERNAL_TOKEN! }, payload: { status: 'normalized' } });
    expect(patched.statusCode).toBe(200); expect(patched.json()).toEqual({ ...expectedEvent, status: 'normalized' });
    const deleted = await app.inject({ method: 'DELETE', url: `/api/integrations/links/${link.id}`, headers: auth() });
    expect(deleted.statusCode).toBe(204); expect(deleted.body).toBe('');
    expect((await send(link)).json()).toEqual({ detail: 'Link not found' });
  });
  it.each(['offline', 'http', 'unique constraint failure'])('returns Python dispatch failure JSON for %s and retains the stored event', async failure => {
    const link = (await create()).json();
    const dispatch = vi.spyOn(globalThis, 'fetch');
    if (failure === 'http') dispatch.mockResolvedValue(new Response('{}', { status: 503 }));
    else dispatch.mockRejectedValue(new Error(failure));
    const result = await send(link);
    expect(result.statusCode).toBe(502); expect(result.json()).toEqual({ detail: 'Partner event was stored but dispatch failed' });
    expect((await getPool().query('SELECT status FROM "integrations_test".partner_events')).rows).toEqual([{ status: 'received' }]);
    const repeated = await send(link); expect(repeated.statusCode).toBe(200); expect(repeated.json()).toEqual({ duplicate: true });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it.each(['application/json', 'text/plain', 'application/octet-stream'])('authenticates and parses exact signed bytes with %s', async contentType => {
    const link = (await create()).json(); const payload = workout({ provider_activity: 'run', event_id: 'unicode-\u00e9' });
    const raw = ` ${JSON.stringify(payload, null, 2)}\n`;
    const response = await app.inject({ method: 'POST', url: `/api/integrations/ingest/${link.id}`,
      headers: { 'content-type': contentType, 'x-habitloop-signature': `sha256=${createHmac('sha256', link.ingest_key).update(raw).digest('hex')}` }, payload: raw });
    expect(response.statusCode).toBe(202);
    expect((await app.inject({ url: `/api/integrations/links/${link.id}/events`, headers: auth() })).json()[0].payload).toEqual(payload);
  });
  it('checks link and signature before malformed JSON and returns Python error body shapes', async () => {
    const link = (await create()).json();
    const badSignature = await send(link, {}, '{', 'sha256=bad');
    expect(badSignature.statusCode).toBe(401); expect(badSignature.json()).toEqual({ detail: 'Invalid or missing partner signature' });
    const badJson = await send(link, {}, '{'); expect(badJson.statusCode).toBe(422); expect(badJson.json().detail).toEqual(expect.any(Array));
    await app.inject({ method: 'DELETE', url: `/api/integrations/links/${link.id}`, headers: auth() });
    const deleted = await send(link, {}, '{', 'sha256=bad');
    expect(deleted.statusCode).toBe(404); expect(deleted.json()).toEqual({ detail: 'Link not found' });
    expect((await getPool().query('SELECT id FROM "integrations_test".partner_events')).rows).toEqual([]);
  });
  it.each(['', 'null', '[]', '42', '{}'])('returns 422 for a correctly signed invalid JSON body %s', async raw => {
    const link = (await create()).json(); const response = await send(link, {}, raw);
    expect(response.statusCode).toBe(422); expect(response.json().detail).toEqual(expect.any(Array));
    expect((await getPool().query('SELECT id FROM "integrations_test".partner_events')).rows).toEqual([]);
  });
  it.each([{ extra: true }, { provider_activity: '' }, { provider_activity: 'x'.repeat(256) }, { steps: true },
    { duration_min: '25' }, { duration_min: 1.5 }, { started_at: '2026-02-30T09:00:00Z' }])('rejects additional invalid signed input %j with a validation detail array', async change => {
    const link = (await create()).json(); const result = await send(link, workout(change));
    expect(result.statusCode).toBe(422); expect(result.json().detail).toEqual(expect.any(Array));
    expect((await getPool().query('SELECT id FROM "integrations_test".partner_events')).rows).toEqual([]);
  });
  it.each([null, undefined])('omits null or absent optional steps (%s) from stored and published payloads', async steps => {
    const link = (await create()).json(); const result = await send(link, workout({ steps }));
    expect(result.statusCode).toBe(202);
    const events = (await app.inject({ url: `/api/integrations/links/${link.id}/events`, headers: auth() })).json();
    expect(events[0].payload).not.toHaveProperty('steps');
    const dispatch = vi.mocked(fetch).mock.calls.at(-1)!;
    expect(JSON.parse(String(dispatch[1]?.body)).detail.raw).not.toHaveProperty('steps');
  });
  it.each([null, '  Unmapped activity  ', '  ' + 'x'.repeat(1000) + '  '])('accepts nullable reasons and trims before validating length', async reason => {
    const link = (await create()).json(); const event = (await send(link)).json();
    const response = await app.inject({ method: 'PATCH', url: `/api/integrations/internal/events/${event.id}`,
      headers: { ...auth(), 'x-internal-token': process.env.INTERNAL_TOKEN! }, payload: { status: 'rejected', reason } });
    expect(response.statusCode).toBe(200); expect(response.json().reason).toBe(reason?.trim() ?? null);
  });
  it.each([{ status: 'bad' }, { status: 'rejected', reason: '' }, { status: 'rejected', reason: '   ' },
    { status: 'rejected', reason: 'x'.repeat(1001) }, { status: 'normalized', extra: true }])('rejects invalid internal PATCH %j without changing the event', async payload => {
    const link = (await create()).json(); const event = (await send(link)).json();
    const response = await app.inject({ method: 'PATCH', url: `/api/integrations/internal/events/${event.id}`,
      headers: { ...auth(), 'x-internal-token': process.env.INTERNAL_TOKEN! }, payload });
    expect(response.statusCode).toBe(422); expect(response.json().detail).toEqual(expect.any(Array));
    expect((await app.inject({ url: `/api/integrations/links/${link.id}/events`, headers: auth() })).json()[0].status).toBe('received');
  });
  it('matches mapped-activity failures, validates each distinct activity once, and forwards user auth', async () => {
    const fetchSpy = vi.mocked(fetch);
    for (const [status, expected, detail] of [[404, 422, 'Mapped activity not found'], [503, 502, 'Mapped activities could not be validated']] as const) {
      fetchSpy.mockResolvedValueOnce(new Response('{}', { status }));
      const response = await create(); expect(response.statusCode).toBe(expected); expect(response.json()).toEqual({ detail });
    }
    expect((await getPool().query('SELECT id FROM "integrations_test".links')).rows).toEqual([]);
    fetchSpy.mockClear();
    expect((await create('mockfit', { run: activity, walk: activity })).statusCode).toBe(201);
    expect(fetchSpy).toHaveBeenCalledTimes(1); expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).get('authorization')).toBe(`Bearer ${token}`);
  });
  it('orders links by id when creation timestamps tie', async () => {
    const first = (await create()).json(); const second = (await create()).json();
    await getPool().query('UPDATE "integrations_test".links SET created_at=$1', [new Date('2026-11-19T00:00:00Z')]);
    const response = await app.inject({ url: '/api/integrations/links', headers: auth() });
    expect(response.json().map((link: { id: string }) => link.id)).toEqual([first.id, second.id].sort().reverse());
  });
  it('accepts concurrent deliveries once and returns the duplicate body for the other request', async () => {
    const link = (await create()).json(); vi.mocked(fetch).mockClear();
    const responses = await Promise.all([send(link), send(link)]);
    expect(responses.map(response => response.statusCode).sort()).toEqual([200, 202]);
    expect(responses.find(response => response.statusCode === 200)!.json()).toEqual({ duplicate: true });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect((await getPool().query('SELECT id FROM "integrations_test".partner_events')).rows).toHaveLength(1);
  });
  it('canonicalizes activity UUIDs and accepts UUIDs without a version restriction', async () => {
    const response = await create('mockfit', { run: activity.toUpperCase(), walk: '00000000-0000-0000-0000-000000000000' });
    expect(response.statusCode).toBe(201); expect(response.json().activity_map).toEqual({ run: activity, walk: '00000000-0000-0000-0000-000000000000' });
  });
  it.each([
    ['2026-11-19T09:00Z', '2026-11-19T09:00:00Z'],
    ['2026-11-19T09:00:00.123Z', '2026-11-19T09:00:00.123000Z'],
    ['2026-11-19 09:00:00+00:00', '2026-11-19T09:00:00Z']
  ])('normalizes stored and published timestamps from %s as Python does', async (started_at, expected) => {
    const link = (await create()).json(); const result = await send(link, workout({ started_at }));
    expect(result.statusCode).toBe(202);
    const events = (await app.inject({ url: `/api/integrations/links/${link.id}/events`, headers: auth() })).json();
    expect(events[0].payload.started_at).toBe(expected);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]?.body)).detail.raw.started_at).toBe(expected);
  });
});
