import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jwtVerify } from 'jose';
import { handler } from '../src/handler.js';

const ids = {
  tenant: '11111111-1111-4111-8111-111111111111', user: '22222222-2222-4222-8222-222222222222',
  link: '33333333-3333-4333-8333-333333333333', partner: '44444444-4444-4444-8444-444444444444',
  activity: '55555555-5555-4555-8555-555555555555', event: '66666666-6666-4666-8666-666666666666'
};
const detail = () => ({ tenant_id: ids.tenant, user_id: ids.user, link_id: ids.link, partner_event_id: ids.partner,
  provider: 'mockfit', raw: { type: 'workout', event_id: ids.event, provider_activity: 'run', duration_min: 25,
    started_at: '2026-11-19T09:00:00+05:30' } });
let calls: Array<{ url: string; init?: RequestInit }>;
let linkRows: unknown[];
let logs: Map<string, unknown>;
let responses: Record<string, number>;
beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret'; process.env.INTERNAL_TOKEN = 'internal';
  process.env.INTEGRATION_SERVICE_URL = 'http://integration:47820'; process.env.ACTIVITY_SERVICE_URL = 'http://activity:47820';
  calls = []; logs = new Map(); responses = {};
  linkRows = [{ id: ids.link, tenant_id: ids.tenant, user_id: ids.user, provider: 'mockfit', status: 'active', activity_map: { run: ids.activity } }];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push({ url, init });
    const status = responses[url] ?? 200;
    let body: unknown = {};
    if (url.endsWith('/api/integrations/links')) body = linkRows;
    if (url.endsWith('/api/activities/internal/logs')) {
      const posted = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const duplicate = logs.has(String(posted.source_event_id)); logs.set(String(posted.source_event_id), posted);
      return new Response(JSON.stringify({ duplicate }), { status: duplicate ? 200 : status });
    }
    return new Response(JSON.stringify(body), { status });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('normalizer parity', () => {
  it.each([
    ['2026-11-19T09:00:00', 'started_at must include a timezone'],
    ['2026-02-30T09:00:00Z', 'started_at must be an ISO timestamp with timezone'],
    ['2026-11-19T24:00:00Z', 'started_at must be an ISO timestamp with timezone'],
    ['2026-11-19T09:00:00+24:00', 'started_at must be an ISO timestamp with timezone']
  ])('preserves the Python rejection reason for %s', async (timestamp, reason) => {
    const event = detail(); event.raw.started_at = timestamp;
    await handler(event);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ status: 'rejected', reason });
  });

  it.each(['2026-11-19 09:00:00+0530', '20261119T090000+05', '2026-11-19T09:00Z'])('accepts Python ISO timestamp %s without changing the log timestamp', async timestamp => {
    const event = detail(); event.raw.started_at = timestamp;
    await handler(event);
    const post = calls.find(call => call.url.endsWith('/api/activities/internal/logs'))!;
    expect(JSON.parse(String(post.init?.body)).logged_at).toBe(timestamp);
  });

  it('canonicalizes Python UUID forms before signing, matching links and creating logs', async () => {
    const event = detail();
    event.tenant_id = `{${ids.tenant.toUpperCase()}}`; event.user_id = ids.user.replaceAll('-', '');
    event.link_id = `urn:uuid:${ids.link}`; event.partner_event_id = ids.partner.toUpperCase();
    (linkRows[0] as Record<string, unknown>).activity_map = { run: ids.activity.replaceAll('-', '') };
    await handler(event);
    const post = calls.find(call => call.url.endsWith('/api/activities/internal/logs'))!;
    expect(JSON.parse(String(post.init?.body))).toMatchObject({ tenant_id: ids.tenant, user_id: ids.user, activity_id: ids.activity, source_event_id: ids.partner });
  });

  it('retries malformed link maps instead of terminally rejecting the workout', async () => {
    delete (linkRows[0] as Record<string, unknown>).activity_map;
    await expect(handler(detail())).rejects.toThrow('Invalid activity map');
    expect(calls).toHaveLength(1);
  });

  it('treats inherited object names as unmapped provider activities', async () => {
    const event = detail(); event.raw.provider_activity = 'toString';
    await handler(event);
    expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({ status: 'rejected', reason: 'Unmapped provider activity: toString' });
  });
  it.each([
    [0, undefined, 'done'], [19, 4999, 'done'], [20, 0, 'completed'], [0, 5000, 'completed'], [25, 6000, 'completed']
  ])('maps duration %s and steps %s to %s with authenticated downstream calls', async (duration, steps, status) => {
    const event = detail(); event.raw.duration_min = duration; event.raw.steps = steps;
    await expect(handler(event)).resolves.toEqual({ batchItemFailures: [] });
    const post = calls.find(call => call.url.endsWith('/api/activities/internal/logs'))!;
    const body = JSON.parse(String(post.init?.body));
    expect(body).toMatchObject({ tenant_id: ids.tenant, user_id: ids.user, activity_id: ids.activity, status, source: 'partner',
      logged_at: event.raw.started_at, duration_min: duration, source_event_id: ids.partner, metadata: { event_id: ids.event } });
    const jwt = post.init?.headers as Record<string, string>;
    const claims = await jwtVerify(jwt.Authorization.slice(7), new TextEncoder().encode(process.env.JWT_SECRET));
    expect(claims.payload).toMatchObject({ tenant_id: ids.tenant, sub: ids.user, email: 'partner@habitloop.internal' });
    expect(Number(claims.payload.exp) - Number(claims.payload.iat)).toBe(3600);
    expect(jwt['X-Internal-Token']).toBe('internal');
    expect(calls.at(-1)?.url).toContain(`/api/integrations/internal/events/${ids.partner}`);
    expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({ status: 'normalized' });
  });

  it('rejects unmapped partner activity with a reason', async () => {
    const event = detail(); event.raw.provider_activity = 'swim'; await handler(event);
    expect(calls.some(call => call.url.endsWith('/api/activities/internal/logs'))).toBe(false);
    expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({ status: 'rejected', reason: 'Unmapped provider activity: swim' });
  });

  it.each([
    null, {}, { type: 'sleep' }, { duration_min: -1 }, { duration_min: true }, { steps: -1 }, { steps: true },
    { started_at: 'bad' }, { started_at: '2026-11-19T09:00:00' }, { event_id: '' }, { provider_activity: null }
  ])('terminally rejects invalid workout %j', async raw => {
    const event = detail();
    if (raw === null || (typeof raw === 'object' && Object.keys(raw).length === 0) || (raw as { type?: string }).type === 'sleep') event.raw = raw;
    else Object.assign(event.raw, raw);
    await handler(event);
    expect(calls.some(call => call.url.endsWith('/api/integrations/links') || call.url.endsWith('/api/activities/internal/logs'))).toBe(false);
    expect(JSON.parse(String(calls.at(-1)?.init?.body))).toMatchObject({ status: 'rejected', reason: expect.any(String) });
  });

  it.each(['missing', 'deleted', 'provider', 'tenant_id', 'user_id', 'mapping'] as const)('rejects link state %s', async changed => {
    if (changed === 'missing') linkRows = [];
    else if (changed === 'deleted') (linkRows[0] as Record<string, unknown>).status = 'deleted';
    else if (changed === 'mapping') (linkRows[0] as Record<string, unknown>).activity_map = { run: 'bad' };
    else (linkRows[0] as Record<string, unknown>)[changed] = changed === 'provider' ? 'mockrun' : '77777777-7777-4777-8777-777777777777';
    await handler(detail());
    expect(calls.some(call => call.url.endsWith('/api/activities/internal/logs'))).toBe(false);
    expect(JSON.parse(String(calls.at(-1)?.init?.body)).status).toBe('rejected');
  });

  it.each([404, 409, 422])('rejects permanent activity response %s', async status => {
    responses['http://activity:47820/api/activities/internal/logs'] = status;
    await handler(detail());
    expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({ status: 'rejected', reason: `Activity log rejected (HTTP ${status})` });
  });

  it('retries marking after the log is created without duplicating the partner log', async () => {
    responses[`http://integration:47820/api/integrations/internal/events/${ids.partner}`] = 503;
    const failPatch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (input, init) => {
      const url = String(input); calls.push({ url, init });
      if (url.endsWith('/api/integrations/links')) return new Response(JSON.stringify(linkRows));
      if (url.endsWith('/api/activities/internal/logs')) { logs.set(ids.partner, JSON.parse(String(init?.body))); return new Response('{}'); }
      return new Response('{}', { status: 503 });
    });
    await expect(handler(detail())).rejects.toThrow('HTTP 503');
    failPatch.mockRestore();
    responses = {};
    await handler(detail());
    expect(logs.size).toBe(1);
    expect(calls.filter(call => call.url.endsWith('/api/activities/internal/logs'))).toHaveLength(2);
  });

  it('returns only failed SQS message identifiers and continues through the batch', async () => {
    const unmapped = detail(); unmapped.partner_event_id = '88888888-8888-4888-8888-888888888888'; unmapped.raw.provider_activity = 'yoga';
    const invalid = detail() as Record<string, unknown>; delete invalid.tenant_id;
    const records = [
      { messageId: 'good', body: JSON.stringify({ 'detail-type': 'PartnerEventReceived', detail: detail() }) },
      { messageId: 'bad-json', body: '{' },
      { messageId: 'unmapped', body: JSON.stringify({ 'detail-type': 'PartnerEventReceived', detail: unmapped }) },
      { messageId: 'bad-identity', body: JSON.stringify(invalid) },
      { messageId: 'last-good', body: JSON.stringify(detail()) }
    ];
    await expect(handler({ Records: records })).resolves.toEqual({ batchItemFailures: [{ itemIdentifier: 'bad-json' }, { itemIdentifier: 'bad-identity' }] });
  });

  it.each(['links', 'logs', 'patch'] as const)('reports transient SQS %s errors for retry', async part => {
    responses[part === 'links' ? 'http://integration:47820/api/integrations/links' : part === 'logs' ? 'http://activity:47820/api/activities/internal/logs' : `http://integration:47820/api/integrations/internal/events/${ids.partner}`] = 503;
    await expect(handler({ Records: [{ messageId: 'retry', body: JSON.stringify(detail()) }] }))
      .resolves.toEqual({ batchItemFailures: [{ itemIdentifier: 'retry' }] });
  });

  it('accepts empty batches and rejects malformed event type', async () => {
    await expect(handler({ Records: [] })).resolves.toEqual({ batchItemFailures: [] });
    await expect(handler({ 'detail-type': 'ActivityLogged', detail: detail() })).rejects.toThrow('Expected PartnerEventReceived');
  });
});
