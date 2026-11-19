import assert from 'node:assert/strict';
import { SignJWT } from 'jose';

// Exercise the built server modules without taking a running service down.
const chunks = new URL('../.svelte-kit/output/server/chunks/', import.meta.url);
const environment = await import(new URL('shared-server.js', chunks));
const setEnvironment = Object.values(environment).find(value => typeof value === 'function' && value.name === 'set_private_env');
const secret = 'server-check-only-secret';
setEnvironment({ API_BASE_URL: 'http://gateway', JWT_SECRET: secret });
const dashboardModule = await import(new URL('dashboard.js', chunks));
const dashboard = Object.values(dashboardModule).find(value => typeof value === 'function' && value.name === 'dashboard');
const { handle } = await import(new URL('../.svelte-kit/output/server/entries/hooks.server.js', import.meta.url));
const item = { id: 'activity-a', name: 'Walk', status: null };
let deleted = false;
const event = {
  url: new URL('http://web/dashboard'), request: new Request('http://web/dashboard'), locals: {},
  cookies: { get: () => 'test-cookie', delete: () => { deleted = true; } },
  fetch: async (url, options) => {
    assert.equal(options.headers.get('Authorization'), 'Bearer test-cookie');
    if (url.includes('/api/analytics/')) throw new Error('Analytics is down');
    return Response.json(url.endsWith('/categories') ? { fitness: 'ti-run' } : [item]);
  }
};
const snapshot = await dashboard(event);
assert.deepEqual(snapshot.today, [item]);
assert.deepEqual(snapshot.activities, [item]);
assert.equal(snapshot.summary, null);
assert.equal(snapshot.trend, null);
assert.equal(snapshot.heatmap, null);
assert.equal(snapshot.milestones, null);
console.log('PASS: analytics outage preserves activities and returns unavailable analytics.');

event.fetch = async () => Response.json({ detail: 'Token expired' }, { status: 401 });
await assert.rejects(dashboard(event), cause => cause.status === 303 && cause.location === '/onboarding?message=expired');
assert.equal(deleted, true);
console.log('PASS: upstream 401 clears the cookie and redirects with an expiry message.');

const expired = await new SignJWT({ tenant_id: 'tenant-a', email: 'a@example.com', name: 'A' })
  .setProtectedHeader({ alg: 'HS256' }).setSubject('user-a').setExpirationTime(Math.floor(Date.now() / 1000) - 30)
  .sign(new TextEncoder().encode(secret));
event.cookies.get = () => expired;
await assert.rejects(handle({ event, resolve: async () => new Response('ok') }), cause => cause.status === 303 && cause.location === '/onboarding?message=expired');
assert.equal(event.locals.user, null);
console.log('PASS: an expired signed JWT is rejected before page loading.');

event.url = new URL('http://web/api/analytics/cohorts');
await assert.rejects(handle({ event, resolve: async () => new Response('ok') }), cause => cause.status === 404);
console.log('PASS: a disabled feature returns 404 at the server boundary.');
