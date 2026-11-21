import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, getConfig, getPool, publish, signToken, verifyToken } from '@habitloop/shared';
import { SignJWT, decodeJwt, decodeProtectedHeader } from 'jose';
import type { FastifyInstance } from 'fastify';
import { initializeUserTables } from '../src/db/init.js';
import { registerUserRoutes } from '../src/routes/users.js';

describe('User Service HTTP contract', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createApp('user-service-test', '/api/users');
    await app.register(async service => registerUserRoutes(service), { prefix: '/api/users' });
    await app.ready();
    await initializeUserTables();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM "users_test"."users"');
    await getPool().query('DELETE FROM "users_test"."tenants"');
  });
  afterAll(async () => { await app.close(); });

  const register = (email = 'alex@example.com', tenant_name = 'NAGP Demo', password = 'Demo-Pass-123') =>
    app.inject({ method: 'POST', url: '/api/users/register', payload: { email, password, name: 'Alex Morgan', tenant_name } });

  it('registers, logs in, returns snake_case profiles and interoperable HS256 claims', async () => {
    const response = await register();
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.user).toMatchObject({ email: 'alex@example.com', name: 'Alex Morgan', timezone: 'UTC' });
    expect(body.user.created_at).toBeTruthy();
    expect(body.user.password_hash).toBeUndefined();
    const login = await app.inject({ method: 'POST', url: '/api/users/login', payload: {
      tenant_slug: 'nagp-demo', email: 'ALEX@example.com', password: 'Demo-Pass-123'
    } });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.id).toBe(body.user.id);
    const me = await app.inject({ method: 'GET', url: '/api/users/me', headers: { authorization: `Bearer ${body.token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().id).toBe(body.user.id);
  });

  it('allows same email across tenants, reuses tenants, and rejects tenant duplicates', async () => {
    const first = await register();
    const second = await register('alex@example.com', 'Second Team');
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().user.tenant_id).not.toBe(first.json().user.tenant_id);
    const joined = await register('sam@example.com', 'NAGP Demo');
    expect(joined.json().user.tenant_id).toBe(first.json().user.tenant_id);
    expect((await register()).statusCode).toBe(409);
  });

  it('returns identical login failures and tenant-scopes profile reads', async () => {
    const first = (await register()).json();
    const second = (await register('other@example.com', 'Other Team')).json();
    const unknownTenant = await app.inject({ method: 'POST', url: '/api/users/login', payload: {
      tenant_slug: 'missing', email: 'alex@example.com', password: 'bad'
    } });
    const badPassword = await app.inject({ method: 'POST', url: '/api/users/login', payload: {
      tenant_slug: 'nagp-demo', email: 'alex@example.com', password: 'bad'
    } });
    expect(unknownTenant.statusCode).toBe(401);
    expect(badPassword.statusCode).toBe(401);
    expect(unknownTenant.json()).toEqual(badPassword.json());
    const mismatchedToken = await signToken({ sub: second.user.id, tenant_id: first.user.tenant_id, email: 'other@example.com', name: 'Other' });
    const forgedScope = await app.inject({ method: 'GET', url: '/api/users/me', headers: { authorization: `Bearer ${mismatchedToken}` } });
    expect(forgedScope.statusCode).toBe(404);
    const internalCrossTenant = await app.inject({ method: 'GET', url: `/api/users/internal/users/${second.user.id}`, headers: {
      authorization: `Bearer ${mismatchedToken}`, 'x-internal-token': process.env.INTERNAL_TOKEN!
    } });
    expect(internalCrossTenant.statusCode).toBe(404);
    const docs = await app.inject({ method: 'GET', url: '/api/users/openapi.json' });
    expect(docs.statusCode).toBe(200);
    expect(docs.json().paths['/api/users/register']).toBeDefined();
    expect((await app.inject({ method: 'GET', url: '/api/users/docs' })).statusCode).toBe(200);
    expect(initializeUserTables).toBeTypeOf('function');
    expect(first.user.tenant_id).not.toBe(second.user.tenant_id);
  });

  it('treats an empty profile patch as a tenant-scoped read', async () => {
    const account = (await register()).json();
    const response = await app.inject({ method: 'PATCH', url: '/api/users/me',
      headers: { authorization: `Bearer ${account.token}` }, payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(account.user);
    const token = await signToken({ sub: account.user.id, tenant_id: '11111111-1111-4111-8111-111111111111',
      email: account.user.email, name: account.user.name });
    const missing = await app.inject({ method: 'PATCH', url: '/api/users/me',
      headers: { authorization: `Bearer ${token}` }, payload: {} });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ detail: 'User not found' });
  });

  it.each([{}, { email: 'invalid' }, { password: '' }, { name: 123 }, { timezone: null }])(
    'returns a 422 detail response for invalid registration: %j', async change => {
      const payload = Object.keys(change).length ? {
        email: 'alex@example.com', password: 'Demo-Pass-123', name: 'Alex', tenant_name: 'NAGP Demo', ...change
      } : {};
      const response = await app.inject({ method: 'POST', url: '/api/users/register', payload });
      expect(response.statusCode).toBe(422);
      expect(response.json().detail).toBeDefined();
      expect((await getPool().query('SELECT * FROM "users_test"."tenants"')).rows).toHaveLength(0);
    }
  );

  it.each([{ name: '' }, { name: null }, { name: 123 }, { timezone: null }, { email: 'other@example.com' }])(
    'rejects invalid profile patches without changing the profile: %j', async payload => {
      const account = (await register()).json();
      const headers = { authorization: `Bearer ${account.token}` };
      const response = await app.inject({ method: 'PATCH', url: '/api/users/me', headers, payload });
      expect(response.statusCode).toBe(422);
      expect(response.json().detail).toBeDefined();
      expect((await app.inject({ method: 'GET', url: '/api/users/me', headers })).json()).toEqual(account.user);
    }
  );

  it.each(['', 'x'.repeat(73), '\u00e9'.repeat(37)])('returns the same 401 for invalid login password lengths', async password => {
    await register();
    for (const email of ['alex@example.com', 'unknown@example.com']) {
      const response = await app.inject({ method: 'POST', url: '/api/users/login', payload: {
        tenant_slug: 'nagp-demo', email, password
      } });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ detail: 'Invalid email or password' });
    }
  });

  it('issues the same JWT claims and expiry as the Python service', async () => {
    const account = (await register()).json();
    const claims = decodeJwt(account.token);
    expect(decodeProtectedHeader(account.token).alg).toBe('HS256');
    expect(Object.keys(claims).sort()).toEqual(['email', 'exp', 'iat', 'name', 'sub', 'tenant_id']);
    expect(claims).toMatchObject({ sub: account.user.id, tenant_id: account.user.tenant_id,
      email: account.user.email, name: account.user.name });
    expect(claims.exp! - claims.iat!).toBe(3600);
  });

  it.each([{ email: '' }, { name: ' ' }, { iat: Math.floor(Date.now() / 1000) + 3600 }])(
    'rejects identity claims rejected by Python: %j', async change => {
      const account = (await register()).json();
      const token = await new SignJWT({ ...decodeJwt(account.token), ...change })
        .setProtectedHeader({ alg: 'HS256' }).sign(getConfig().jwtSecret);
      await expect(verifyToken(token)).rejects.toThrow();
    }
  );

  it('permits browser profile updates and exposes request ids', async () => {
    const origin = `http://localhost:${getConfig().webPort}`;
    const response = await app.inject({ method: 'OPTIONS', url: '/api/users/me', headers: {
      origin, 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'authorization,content-type'
    } });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-methods']).toContain('PATCH');
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    const health = await app.inject({ method: 'GET', url: '/health', headers: { origin, 'x-request-id': 'review-check' } });
    expect(health.headers['access-control-expose-headers']).toContain('X-Request-ID');
    expect(health.headers['x-request-id']).toBe('review-check');
  });

  it('publishes events using the app service name', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 202 }));
    try {
      await publish('ReviewEvent', { tenant_id: 'test' });
      const envelope = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
      expect(envelope.source).toBe('habitloop.user-service-test');
    } finally { fetch.mockRestore(); }
  });
});
