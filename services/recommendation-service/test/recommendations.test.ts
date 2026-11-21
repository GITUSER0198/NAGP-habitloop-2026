import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPool } from '@habitloop/shared';
import { NOW, PREFIX, createHarness, timing, type Harness, type Json } from './harness.js';

// Ports services/recommendation-service/tests/test_recommendations.py from the Python build, case for case.
describe('recommendation rules, service calls, retries and isolation', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(); });
  beforeEach(async () => { await h.reset(); });
  afterEach(() => { vi.restoreAllMocks(); });
  afterAll(async () => { await h.close(); });
  const effects = () => h.downstream.effects;
  const accepted = () => effects().filter(([kind]) => kind === 'RecommendationAccepted');

  it('uses the best eligible window and formats the reason', async () => {
    timing(h.downstream);
    const rows = await h.refresh();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.kind).toBe('timing');
    expect(row.current_value).toEqual({ preferred_time: '20:30' });
    expect(row.suggested_value).toEqual({ preferred_time: '07:00' });
    expect(row.confidence).toBe('medium');
    expect(row.reason).toBe('You complete Running 82% of the time around 7:00 AM vs 40% around 8:00 PM');
    expect(row.tenant_id).toBe(h.identity.tenant_id);
    expect(row.user_id).toBe(h.identity.user_id);
    expect(row.created_at.endsWith('Z')).toBe(true);
    expect(row.status).toBe('pending');
    const listed = await h.call('GET', '?status=pending');
    expect(listed.json()).toEqual({ recommendations: rows });
    const requests = h.downstream.requests;
    expect(requests).toHaveLength(3);
    expect(requests[1]!.url.pathname).toBe(`/api/analytics/internal/users/${h.identity.user_id}/hours`);
    expect(requests[2]!.url.pathname).toBe(`/api/activities/internal/users/${h.identity.user_id}/logs`);
    expect(new Date(requests[2]!.url.searchParams.get('since')!).getTime()).toBe(NOW.getTime() - 14 * 86400000);
    for (const request of requests) {
      expect(request.headers.get('authorization')).toBe(h.headers.authorization);
      expect(request.headers.get('x-internal-token')).toBe(process.env.INTERNAL_TOKEN);
    }
  });

  it('keeps the JSON shape and key order of the Python response', async () => {
    timing(h.downstream);
    const response = await h.call('POST', '/refresh');
    expect(response.headers['content-type']).toContain('application/json');
    expect(Object.keys(response.json())).toEqual(['recommendations']);
    expect(Object.keys(response.json().recommendations[0])).toEqual(['id', 'tenant_id', 'user_id', 'activity_id', 'kind', 'current_value', 'suggested_value', 'reason', 'confidence', 'status', 'created_at']);
  });

  it.each([[12, false], [13, true], [14, true]])('applies the 15 point boundary (best successes %i of 20 -> %s)', async (successes, expected) => {
    h.downstream.hours = [{ hour: 7, attempts: 20, successes }, { hour: 20, attempts: 20, successes: 10 }];
    expect((await h.refresh()).length > 0).toBe(expected);
  });

  it.each([
    [[]],
    [[{ hour: 7, attempts: 2, successes: 2 }, { hour: 20, attempts: 2, successes: 0 }]],
    [[{ hour: 7, attempts: 3, successes: 3 }]],
    [[{ hour: 7, attempts: 3, successes: 3 }, { hour: 20, attempts: 2, successes: 0 }]]
  ])('explains insufficient data (%j)', async hours => {
    h.downstream.hours = hours;
    h.downstream.logs = [h.log('missed'), h.log('missed')];
    const expected = { recommendations: [], reason: 'needs at least 3 logs per time window' };
    expect((await h.call('POST', '/refresh')).json()).toEqual(expected);
    expect((await h.call('GET')).json()).toEqual(expected);
  });

  it('gives no misleading reason when data is enough but nothing improves', async () => {
    h.downstream.hours = [{ hour: 7, attempts: 3, successes: 3 }, { hour: 20, attempts: 3, successes: 3 }];
    expect(await h.refresh()).toEqual([]);
    expect((await h.call('GET')).json()).toEqual({ recommendations: [] });
    expect((await h.call('POST', '/refresh')).json()).toEqual({ recommendations: [] });
  });

  it.each([[3, 'low'], [9, 'low'], [10, 'medium'], [29, 'medium'], [30, 'high']])('timing confidence uses the smaller window sample (%i -> %s)', async (attempts, confidence) => {
    h.downstream.hours = [{ hour: 7, attempts: 40, successes: 40 }, { hour: 20, attempts: attempts, successes: 0 }];
    expect((await h.refresh())[0]!.confidence).toBe(confidence);
  });

  it('breaks ties by most evidence, then earliest hour', async () => {
    h.downstream.hours = [{ hour: 9, attempts: 4, successes: 4 }, { hour: 8, attempts: 5, successes: 5 }, { hour: 7, attempts: 5, successes: 5 }, { hour: 20, attempts: 3, successes: 0 }];
    expect((await h.refresh())[0]!.suggested_value).toEqual({ preferred_time: '07:00' });
  });

  it('prefers the higher rate over a larger sample', async () => {
    h.downstream.hours = [{ hour: 6, attempts: 30, successes: 24 }, { hour: 7, attempts: 3, successes: 3 }, { hour: 20, attempts: 10, successes: 4 }];
    expect((await h.refresh())[0]!.suggested_value).toEqual({ preferred_time: '07:00' });
  });

  it('does not suggest the activity own hour as the best window', async () => {
    h.downstream.activities[0]!.preferred_time = '07:15';
    h.downstream.hours = [{ hour: 7, attempts: 20, successes: 20 }, { hour: 20, attempts: 20, successes: 0 }];
    expect(await h.refresh()).toEqual([]);
  });

  it.each([[0, true], [6, true], [7, false], [14, false]])('applies the daily frequency rule and 50 percent boundary (%i completed -> %s)', async (completed, expected) => {
    h.downstream.logs = Array.from({ length: 14 }, (_, day) => h.log(day < completed ? 'completed' : 'missed', day + 0.5));
    const rows = await h.refresh();
    expect(rows.length > 0).toBe(expected);
    if (expected) {
      expect(rows[0]).toMatchObject({ kind: 'frequency', current_value: { target_per_week: 7 }, suggested_value: { target_per_week: 3 }, confidence: 'medium' });
      expect(rows[0]!.reason).toContain(`${completed} of the last 14 daily targets`);
      expect(rows[0]!.reason).toBe(`You completed Running ${completed} of the last 14 daily targets (${Math.round(completed / 14 * 100)}%). Try a target of 3 per week.`);
    }
  });

  it('counts only current-activity full completions inside the 14 day window', async () => {
    // Partial completions are attempts, but do not meet a full daily target.
    const other = (changes: Json): Json => ({ ...h.log('completed'), ...changes });
    h.downstream.logs = [
      ...[1, 2, 3, 4, 5, 6].map(day => h.log('done', day)), h.log('completed', 14.01), h.log('completed', -1),
      ...Array.from({ length: 14 }, () => other({ activity_id: randomUUID() })),
      ...Array.from({ length: 14 }, () => other({ tenant_id: randomUUID() })),
      ...Array.from({ length: 14 }, () => other({ user_id: randomUUID() }))
    ];
    const row = (await h.refresh())[0]!;
    expect(row.reason).toContain('0 of the last 14 daily targets');
    expect(row.suggested_value).toEqual({ target_per_week: 3 });
    expect(row.confidence).toBe('low');
  });

  it.each([['weekly', 7], ['custom', 7], ['daily', 3], ['daily', 2]])('only reduces daily targets above 3 (%s, target %i)', async (frequency, target) => {
    Object.assign(h.downstream.activities[0]!, { frequency, target_per_week: target });
    h.downstream.logs = Array.from({ length: 14 }, () => h.log('missed'));
    expect(await h.refresh()).toEqual([]);
  });

  it('needs three logs before a frequency suggestion', async () => {
    h.downstream.logs = [h.log('missed'), h.log('missed')];
    expect(await h.refresh()).toEqual([]);
    h.downstream.logs.push(h.log('missed'));
    expect((await h.refresh())[0]!.kind).toBe('frequency');
  });

  it('dedupes by values and activity across both rules', async () => {
    timing(h.downstream);
    h.downstream.logs = [1, 2, 3].map(day => h.log('missed', day));
    h.downstream.activities.push({ ...h.downstream.activities[0]!, id: randomUUID(), name: 'Reading' });
    const first = await h.refresh();
    expect(first).toHaveLength(3);
    expect(first.map(row => row.kind).sort()).toEqual(['frequency', 'timing', 'timing']);
    expect(new Set((await h.refresh()).map(row => row.id))).toEqual(new Set(first.map(row => row.id)));
    h.downstream.activities[0]!.preferred_time = '20:45';
    expect(await h.refresh()).toHaveLength(4);
  });

  it('lists suggestions in creation order', async () => {
    timing(h.downstream);
    h.downstream.logs = [1, 2, 3].map(day => h.log('missed', day));
    const first = await h.refresh();
    expect(first.map(row => row.kind)).toEqual(['timing', 'frequency']);
    expect(first.map(row => row.created_at)).toEqual([...first.map(row => row.created_at)].sort());
  });

  it('lets the database prevent duplicate pending values', async () => {
    timing(h.downstream);
    const row = (await h.refresh())[0]!;
    const insert = () => getPool().query(`INSERT INTO "recommendations_test"."recommendations" (id, tenant_id, user_id, activity_id, kind, current_value, suggested_value, reason, confidence, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', now())`, [randomUUID(), row.tenant_id, row.user_id, row.activity_id, row.kind, JSON.stringify(row.current_value), JSON.stringify(row.suggested_value), row.reason, row.confidence]);
    await expect(insert()).rejects.toThrow(/unique|duplicate/i);
    // A dismissed row frees the values again.
    await h.call('POST', `/${row.id}/dismiss`);
    await expect(insert()).resolves.toBeDefined();
  });

  it.each(['timing', 'frequency'])('accepts a %s suggestion once: patch, then publish, idempotent after', async kind => {
    if (kind === 'timing') timing(h.downstream); else h.downstream.logs = [h.log('missed'), h.log('missed'), h.log('missed')];
    const row = (await h.refresh())[0]!;
    const path = `/${row.id}/accept`;
    const first = await h.call('POST', path);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().status).toBe('accepted');
    expect((await h.call('POST', path)).json()).toEqual(first.json());
    expect(effects()).toEqual([['patch', row.suggested_value], ['RecommendationAccepted', { ...h.identity, recommendation_id: row.id, activity_id: row.activity_id }]]);
    const patches = h.downstream.requests.filter(request => request.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]!.url.pathname).toBe(`/api/activities/internal/${row.activity_id}/schedule`);
    expect(patches[0]!.headers.get('authorization')).toBe(h.headers.authorization);
    expect(patches[0]!.headers.get('x-internal-token')).toBe(process.env.INTERNAL_TOKEN);
    expect(patches[0]!.body).toEqual(row.suggested_value);
    expect((await h.call('GET', '?status=accepted')).json().recommendations[0]).toEqual(first.json());
    expect((await h.call('POST', `/${row.id}/dismiss`)).statusCode).toBe(409);
    expect((await h.call('POST', `/${row.id}/dismiss`)).json()).toEqual({ detail: 'Recommendation is already accepted' });
  });

  it('publishes RecommendationAccepted from the recommendation source', async () => {
    timing(h.downstream);
    const row = (await h.refresh())[0]!;
    await h.call('POST', `/${row.id}/accept`);
    const event = h.downstream.requests.find(request => request.url.pathname === '/events')!;
    expect(event.body).toMatchObject({ source: 'habitloop.recommendation', 'detail-type': 'RecommendationAccepted' });
  });

  it('serialises concurrent accepts into one patch and one event', async () => {
    timing(h.downstream);
    const row = (await h.refresh())[0]!;
    const results = await Promise.all([1, 2, 3].map(() => h.call('POST', `/${row.id}/accept`)));
    expect(results.map(result => result.statusCode)).toEqual([200, 200, 200]);
    expect(accepted()).toHaveLength(1);
    expect(h.downstream.requests.filter(request => request.method === 'PATCH')).toHaveLength(1);
  });

  it.each([404, 409])('dismisses and conflicts when the activity answers %i', async activityStatus => {
    timing(h.downstream);
    const row = (await h.refresh())[0]!;
    h.downstream.patchStatus = activityStatus;
    const path = `/${row.id}/accept`;
    const first = await h.call('POST', path);
    expect(first.statusCode).toBe(409);
    expect(first.json()).toEqual({ detail: 'Activity no longer applies' });
    const second = await h.call('POST', path);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ detail: 'Recommendation is dismissed' });
    expect(effects()).toHaveLength(1);
    const dismissed = (await h.call('GET', '?status=dismissed')).json().recommendations;
    expect(dismissed[0]).toMatchObject({ status: 'dismissed', id: row.id });
  });

  it('dismisses idempotently and allows new pending values afterwards', async () => {
    timing(h.downstream);
    const row = (await h.refresh())[0]!;
    const path = `/${row.id}/dismiss`;
    const dismissed = await h.call('POST', path);
    expect(dismissed.statusCode).toBe(200);
    expect(dismissed.json().status).toBe('dismissed');
    expect((await h.call('POST', path)).json()).toEqual(dismissed.json());
    const accept = await h.call('POST', `/${row.id}/accept`);
    expect(accept.statusCode).toBe(409);
    expect(accept.json()).toEqual({ detail: 'Recommendation is dismissed' });
    expect(effects()).toEqual([]);
    expect((await h.refresh())[0]!.id).not.toBe(row.id);
  });

  it.each([['tenant'], ['user']])('isolates by %s for list, refresh, accept and dismiss', async scope => {
    timing(h.downstream);
    const row = (await h.refresh())[0]!;
    const foreign = await h.tokenFor({ ...h.identity, ...(scope === 'tenant' ? { tenant_id: randomUUID() } : { user_id: randomUUID() }) });
    expect((await h.call('GET', '', foreign)).json()).toEqual({ recommendations: [] });
    expect(await h.refresh(foreign)).toEqual([]);
    for (const action of ['accept', 'dismiss']) {
      const response = await h.call('POST', `/${row.id}/${action}`, foreign);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ detail: 'Recommendation not found' });
    }
    expect(effects()).toEqual([]);
    expect((await h.call('GET')).json().recommendations[0].status).toBe('pending');
  });

  it('ignores inactive and foreign activities', async () => {
    timing(h.downstream);
    const original = h.downstream.activities[0]!;
    h.downstream.activities = [{ ...original, active: false }, { ...original, id: randomUUID(), tenant_id: randomUUID() }, { ...original, id: randomUUID(), user_id: randomUUID() }];
    expect(await h.refresh()).toEqual([]);
    expect(h.downstream.requests).toHaveLength(1);
  });

  it.each(['status', 'transport'])('treats a history failure (%s) as retryable and creates nothing', async failure => {
    timing(h.downstream);
    if (failure === 'status') h.downstream.historyStatus = 503; else h.downstream.transportError = true;
    const refresh = await h.call('POST', '/refresh');
    expect(refresh.statusCode).toBe(503);
    expect(refresh.json()).toEqual({ detail: 'Recommendation history is unavailable' });
    expect((await h.call('GET')).statusCode).toBe(503);
    h.downstream.historyStatus = 200; h.downstream.transportError = false;
    expect(await h.refresh()).toHaveLength(1);
  });

  it.each([
    ['activity list is not an array', (state: typeof h.downstream) => { state.activities = {} as never; }],
    ['activity has a bad preferred_time', (state: typeof h.downstream) => { state.activities[0]!.preferred_time = '25:00'; }],
    ['activity target is out of range', (state: typeof h.downstream) => { state.activities[0]!.target_per_week = 8; }],
    ['hour counts are inconsistent', (state: typeof h.downstream) => { state.hours = [{ hour: 7, attempts: 3, successes: 4 }]; }],
    ['hour is out of range', (state: typeof h.downstream) => { state.hours = [{ hour: 24, attempts: 3, successes: 1 }]; }],
    ['log timestamp has no timezone', (state: typeof h.downstream) => { state.logs = [{ ...h.log('missed'), logged_at: '2026-11-18T12:00:00' }]; }],
    ['log status is unknown', (state: typeof h.downstream) => { state.logs = [{ ...h.log('missed'), status: 'skipped' }]; }]
  ])('returns 503 when upstream data is malformed (%s)', async (_name, corrupt) => {
    h.downstream.hours = [{ hour: 7, attempts: 3, successes: 3 }];
    corrupt(h.downstream);
    const response = await h.call('POST', '/refresh');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ detail: 'Recommendation history is unavailable' });
  });

  it.each(['patch', 'event', 'transport'])('keeps a suggestion pending after a failed accept (%s) and allows retry', async failure => {
    timing(h.downstream);
    const row = (await h.refresh())[0]!;
    h.downstream.patchStatus = failure === 'patch' ? 503 : 200;
    h.downstream.eventError = failure === 'event';
    h.downstream.transportError = failure === 'transport';
    const path = `/${row.id}/accept`;
    const failed = await h.call('POST', path);
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toEqual({ detail: 'Recommendation could not be accepted; retry later' });
    expect((await h.call('GET')).json().recommendations[0].status).toBe('pending');
    expect(accepted()).toHaveLength(0);
    Object.assign(h.downstream, { patchStatus: 200, eventError: false, transportError: false });
    expect((await h.call('POST', path)).json().status).toBe('accepted');
    expect(accepted()).toHaveLength(1);
  });

  it('requires authentication, validates status and unknown ids', async () => {
    const none = {};
    for (const [method, path] of [['GET', ''], ['POST', '/refresh'], ['POST', `/${randomUUID()}/accept`], ['POST', `/${randomUUID()}/dismiss`]] as const) {
      const response = await h.call(method, path, none);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ detail: 'Invalid or missing bearer token' });
    }
    expect((await h.call('GET', '', { authorization: 'Bearer not-a-token' })).statusCode).toBe(401);
    const bad = await h.call('GET', '?status=unknown');
    expect(bad.statusCode).toBe(422);
    expect(bad.json().detail[0].loc).toEqual(['query', 'status']);
    for (const action of ['accept', 'dismiss']) {
      expect((await h.call('POST', `/${randomUUID()}/${action}`)).statusCode).toBe(404);
      const invalid = await h.call('POST', `/invalid/${action}`);
      expect(invalid.statusCode).toBe(422);
      expect(invalid.json().detail[0].loc).toEqual(['path', 'id']);
    }
  });

  it('serves the list at the prefix with and without a trailing slash and defaults to pending', async () => {
    timing(h.downstream);
    const row = (await h.refresh())[0]!;
    expect((await h.call('GET', '/')).json()).toEqual({ recommendations: [row] });
    expect((await h.call('GET', '')).json()).toEqual({ recommendations: [row] });
    expect((await h.call('GET', '?status=dismissed')).json()).toEqual({ recommendations: [] });
    expect((await h.call('GET', '?status=accepted')).json()).toEqual({ recommendations: [] });
  });

  it('does not consult upstream services for a non-pending list', async () => {
    expect((await h.call('GET', '?status=dismissed')).json()).toEqual({ recommendations: [] });
    expect(h.downstream.requests).toHaveLength(0);
  });

  it('returns an empty list without a reason when the user has no active activities', async () => {
    h.downstream.activities = [];
    expect((await h.call('POST', '/refresh')).json()).toEqual({ recommendations: [] });
    expect(h.downstream.requests).toHaveLength(1);
  });
});
