import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, PREFIX, type Harness } from './harness.js';

// Ports test_health.py: health and docs are reachable at the root and under the service prefix.
describe('health and docs', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(async () => { await h.close(); });

  it.each(['/health', `${PREFIX}/health`])('answers %s with the service name and a request id', async url => {
    const response = await h.app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'recommendation-service' });
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it.each(['/docs', `${PREFIX}/docs`, `${PREFIX}/openapi.json`])('serves %s', async url => {
    const response = await h.app.inject({ method: 'GET', url, ...(url.endsWith('docs') ? { headers: {} } : {}) });
    expect([200, 302]).toContain(response.statusCode);
  });

  it('documents the public routes and hides nothing it should show', async () => {
    const paths = Object.keys((await h.app.inject({ method: 'GET', url: `${PREFIX}/openapi.json` })).json().paths);
    expect(paths).toEqual(expect.arrayContaining([`${PREFIX}/refresh`, `${PREFIX}/{id}/accept`, `${PREFIX}/{id}/dismiss`]));
  });

  it('echoes a supplied request id', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'abc-123' } });
    expect(response.headers['x-request-id']).toBe('abc-123');
  });
});
