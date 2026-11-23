import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigForTests } from '@habitloop/shared/config';
import { handler as normalizer } from '@habitloop/event-normalizer';
import { handler as updater } from '@habitloop/analytics-updater';
import { createWorker, type EventHandler } from '../src/main.js';
import pythonResponses from './python-responses.json';

vi.mock('@habitloop/event-normalizer', () => ({ handler: vi.fn() }));
vi.mock('@habitloop/analytics-updater', () => ({ handler: vi.fn() }));

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret'; process.env.INTERNAL_TOKEN = 'worker-internal';
  process.env.DATABASE_URL = 'postgresql://habitloop:habitloop@127.0.0.1/habitloop';
  process.env.DB_SCHEMA = 'public'; resetConfigForTests();
  vi.clearAllMocks();
});
afterEach(() => resetConfigForTests());

describe('event worker HTTP parity', () => {
  // These fixtures were captured by executing the Python routes from git HEAD.
  it.each(pythonResponses)('matches Python response: $name', async scenario => {
    const app = await createWorker({ Fail: [async () => { throw new Error('private failure'); }] });
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (scenario.auth !== false) headers['x-internal-token'] = typeof scenario.auth === 'string' ? scenario.auth : 'worker-internal';
      const response = await app.inject({ method: scenario.method === 'GET' ? 'GET' : 'POST', url: scenario.url ?? '/events', headers,
        ...((scenario.method !== 'GET') ? { payload: scenario.raw ?? JSON.stringify(scenario.payload) } : {}) });
      expect(response.statusCode).toBe(scenario.status);
      if ('text' in scenario) expect(response.body).toBe(scenario.text);
      else expect(response.json()).toEqual(scenario.body);
    } finally { await app.close(); }
  });

  it.each([['PartnerEventReceived', normalizer], ['ActivityLogged', updater]] as const)('registers the actual %s handler and passes plain detail', async (type, handler) => {
    const app = await createWorker();
    try {
      const detail = { tenant_id: 'tenant', log_id: 'log', partner_event_id: 'event' };
      const response = await app.inject({ method: 'POST', url: '/events', headers: { 'x-internal-token': 'worker-internal' }, payload: { 'detail-type': type, detail } });
      expect(response.statusCode).toBe(202);
      expect(handler).toHaveBeenCalledExactlyOnceWith(detail);
    } finally { await app.close(); }
  });

  it('routes ActivityLogDeleted to the analytics updater with its detail-type', async () => {
    const app = await createWorker();
    try {
      const detail = { tenant_id: 'tenant', log_id: 'log' };
      const response = await app.inject({ method: 'POST', url: '/events', headers: { 'x-internal-token': 'worker-internal' }, payload: { 'detail-type': 'ActivityLogDeleted', detail } });
      expect(response.statusCode).toBe(202);
      expect(updater).toHaveBeenCalledExactlyOnceWith({ 'detail-type': 'ActivityLogDeleted', detail });
    } finally { await app.close(); }
  });

  it('stops dispatch after a failed handler and preserves handler order', async () => {
    const calls: number[] = [];
    const app = await createWorker({ Test: [async () => { calls.push(1); }, async () => { calls.push(2); throw new Error('failed'); }, async () => { calls.push(3); }] });
    try {
      const response = await app.inject({ method: 'POST', url: '/events', headers: { 'x-internal-token': 'worker-internal' }, payload: { 'detail-type': 'Test', detail: {} } });
      expect(response.statusCode).toBe(500); expect(calls).toEqual([1, 2]);
      expect(response.body).toBe('Internal Server Error');
    } finally { await app.close(); }
  });

  it('serves the required docs endpoint', async () => {
    const app = await createWorker();
    try { expect((await app.inject('/docs/')).statusCode).toBe(200); }
    finally { await app.close(); }
  });
  it('matches Python health status and JSON response', async () => {
    const app = await createWorker();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ status: 'ok', service: 'event-worker' });
    await app.close();
  });

  it('requires the internal token with Python route status and JSON shape', async () => {
    const app = await createWorker();
    const response = await app.inject({ method: 'POST', url: '/events', payload: { 'detail-type': 'ActivityLogged', detail: { log_id: 'id' } } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ detail: 'Invalid or missing internal token' });
    await app.close();
  });

  it('dispatches plain detail to the matching handler and returns the Python response', async () => {
    const received: Record<string, unknown>[] = [];
    const handlers: Record<string, EventHandler[]> = { PartnerEventReceived: [async detail => { received.push(detail); }] };
    const app = await createWorker(handlers);
    const detail = { tenant_id: 'tenant', partner_event_id: 'partner' };
    const response = await app.inject({ method: 'POST', url: '/events', headers: { 'x-internal-token': 'worker-internal' },
      payload: { 'detail-type': 'PartnerEventReceived', detail } });
    expect(response.statusCode).toBe(202); expect(response.json()).toEqual({ status: 'accepted' }); expect(received).toEqual([detail]);
    await app.close();
  });

  it('matches the Python 422 detail array for a missing event field', async () => {
    const app = await createWorker();
    const response = await app.inject({ method: 'POST', url: '/events', headers: { 'x-internal-token': 'worker-internal' }, payload: { detail: {} } });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ detail: [{ type: 'missing', loc: ['body', 'detail-type'], msg: 'Field required', input: { detail: {} } }] });
    await app.close();
  });

  it('accepts unknown types with no dispatch, as the Python worker does', async () => {
    const app = await createWorker();
    const response = await app.inject({ method: 'POST', url: '/events', headers: { 'x-internal-token': 'worker-internal' },
      payload: { 'detail-type': 'IgnoredEvent', detail: { tenant_id: 'tenant' } } });
    expect(response.statusCode).toBe(202); expect(response.json()).toEqual({ status: 'accepted' });
    await app.close();
  });
});
