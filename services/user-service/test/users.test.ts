import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, getConfig, getPool, publish, signToken, verifyToken } from '@habitloop/shared';
import { SignJWT, decodeJwt, decodeProtectedHeader } from 'jose';
import type { FastifyInstance } from 'fastify';
import { initializeUserTables } from '../src/db/init.js';
import { registerUserRoutes } from '../src/routes/users.js';
import { emailDomain, isPublicDomain } from '../src/organization.js';

type Account = { token: string; user: { id: string; email: string; tenant_id: string; created_at: string }; community: { id: string; name: string; kind: string } };

describe('User Service HTTP contract', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createApp('user-service-test', '/api/users');
    await app.register(async service => registerUserRoutes(service), { prefix: '/api/users' });
    await app.ready();
    await initializeUserTables();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM "users_test"."memberships"');
    await getPool().query('DELETE FROM "users_test"."users"');
    await getPool().query('DELETE FROM "users_test"."tenants"');
  });
  afterAll(async () => { await app.close(); });

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const register = (email = 'alex@example.com', password = 'Demo-Pass-123', name = 'Alex Morgan') =>
    app.inject({ method: 'POST', url: '/api/users/register', payload: { email, password, name } });
  const account = async (email = 'alex@example.com'): Promise<Account> => (await register(email)).json() as Account;
  const post = (url: string, token: string, payload?: unknown) =>
    app.inject({ method: 'POST', url, headers: bearer(token), payload: payload as object | undefined });
  const get = (url: string, token: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
  const createCommunity = (token: string, name = 'Morning Runners', description?: string) =>
    post('/api/users/communities', token, { name, description });
  const tenantOf = (token: string): string => decodeJwt(token).tenant_id as string;

  it('registers into a Personal space and logs in with only email and password', async () => {
    const response = await register();
    expect(response.statusCode).toBe(201);
    const body = response.json() as Account;
    expect(body.user).toMatchObject({ email: 'alex@example.com', name: 'Alex Morgan', timezone: 'UTC' });
    expect(body.community).toMatchObject({ name: 'Personal space', kind: 'personal' });
    expect(tenantOf(body.token)).toBe(body.community.id);
    expect(body.user).not.toHaveProperty('password_hash');
    const login = await app.inject({ method: 'POST', url: '/api/users/login', payload: { email: 'ALEX@example.com', password: 'Demo-Pass-123' } });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.id).toBe(body.user.id);
    expect(login.json().community.kind).toBe('personal');
    const me = await get('/api/users/me', body.token);
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ id: body.user.id, community: { id: body.community.id, kind: 'personal' } });
  });

  it('rejects a second account with the same email, even with different casing', async () => {
    expect((await register()).statusCode).toBe(201);
    const again = await register('ALEX@example.com');
    expect(again.statusCode).toBe(409);
    expect(again.json().detail).toBe('An account with this email already exists');
  });

  it('logs in to the last active community and falls back to the Personal space after leaving it', async () => {
    const first = await account();
    const owner = await account('owner@example.com');
    const created = (await createCommunity(owner.token, 'Book Club')).json() as Account;
    const joined = await post(`/api/users/communities/${created.community.id}/join`, first.token);
    expect(joined.statusCode).toBe(200);
    const login = await app.inject({ method: 'POST', url: '/api/users/login', payload: { email: 'alex@example.com', password: 'Demo-Pass-123' } });
    expect(login.json().community).toMatchObject({ id: created.community.id, kind: 'community' });
    const left = await post(`/api/users/communities/${created.community.id}/leave`, joined.json().token);
    expect(left.statusCode).toBe(200);
    expect(left.json().community.kind).toBe('personal');
    const relogin = await app.inject({ method: 'POST', url: '/api/users/login', payload: { email: 'alex@example.com', password: 'Demo-Pass-123' } });
    expect(relogin.json().community.kind).toBe('personal');
  });

  it('creates a community, makes the creator its owner and returns a token switched to it', async () => {
    const owner = await account();
    const response = await createCommunity(owner.token, '  Morning Runners  ', 'Early birds');
    expect(response.statusCode).toBe(201);
    const body = response.json() as Account;
    expect(body.community).toMatchObject({ name: 'Morning Runners', kind: 'community' });
    expect(tenantOf(body.token)).toBe(body.community.id);
    const mine = (await get('/api/users/communities', body.token)).json() as Array<{ name: string; kind: string; role: string; member_count: number; active: boolean }>;
    expect(mine.map(item => item.kind)).toEqual(['personal', 'organization', 'community']);
    expect(mine[2]).toMatchObject({ name: 'Morning Runners', role: 'owner', member_count: 1, active: true, description: 'Early birds' });
    expect(mine[0]).toMatchObject({ role: 'owner', member_count: 1, active: false });
  });

  it('parses email domains and recognises public mail providers', () => {
    expect(emailDomain('  Dhruv.Goel@Nagarro.COM ')).toBe('nagarro.com');
    expect(emailDomain('no-at-sign')).toBe('');
    for (const domain of ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'proton.me', 'protonmail.com']) expect(isPublicDomain(domain)).toBe(true);
    expect(isPublicDomain('nagarro.com')).toBe(false);
  });

  it('auto-joins the organization of a non-public email domain; the first user becomes owner', async () => {
    const first = await account('a@nagarro.com');
    const second = await account('b@nagarro.com');
    const me = (await get('/api/users/me', first.token)).json();
    expect(me.organization).toMatchObject({ domain: 'nagarro.com' });
    expect((await get('/api/users/me', second.token)).json().organization.id).toBe(me.organization.id);
    const mine = (await get('/api/users/communities', first.token)).json() as Array<{ id: string; name: string; kind: string; role: string; member_count: number }>;
    expect(mine.find(item => item.kind === 'organization')).toMatchObject({ name: 'nagarro.com', role: 'owner', member_count: 2 });
    const other = (await get('/api/users/communities', second.token)).json() as Array<{ kind: string; role: string }>;
    expect(other.find(item => item.kind === 'organization')!.role).toBe('member');
    const switched = await post('/api/users/switch', second.token, { community_id: me.organization.id });
    expect(switched.statusCode).toBe(200);
    expect(switched.json().community).toMatchObject({ name: 'nagarro.com', kind: 'organization' });
  });

  it('gives public email domains no organization', async () => {
    const acct = await account('someone@gmail.com');
    expect((await get('/api/users/me', acct.token)).json().organization).toBeNull();
    const mine = (await get('/api/users/communities', acct.token)).json() as Array<{ kind: string }>;
    expect(mine.map(item => item.kind)).toEqual(['personal']);
  });

  it('keeps organizations out of Discover and isolates them from other domains', async () => {
    const insider = await account('a@nagarro.com');
    const outsider = await account('x@example.com');
    const orgId = (await get('/api/users/me', insider.token)).json().organization.id as string;
    expect((await get('/api/users/communities/discover', outsider.token)).json()).toEqual([]);
    expect((await post(`/api/users/communities/${orgId}/join`, outsider.token)).statusCode).toBe(404);
    expect((await post('/api/users/switch', outsider.token, { community_id: orgId })).statusCode).toBe(403);
    expect((await post(`/api/users/communities/${orgId}/leave`, insider.token)).statusCode).toBe(409);
    const names = ((await get('/api/users/communities', outsider.token)).json() as Array<{ name: string }>).map(item => item.name);
    expect(names).not.toContain('nagarro.com');
  });

  it('validates community names (3 to 60 characters) and rejects duplicate names with 409', async () => {
    const owner = await account();
    expect((await createCommunity(owner.token, 'ab')).statusCode).toBe(422);
    expect((await createCommunity(owner.token, 'x'.repeat(61))).statusCode).toBe(422);
    expect((await createCommunity(owner.token, '!!!')).statusCode).toBe(422);
    expect((await createCommunity(owner.token, 'x'.repeat(60))).statusCode).toBe(201);
    expect((await createCommunity(owner.token, 'abc')).statusCode).toBe(201);
    const other = await account('other@example.com');
    const duplicate = await createCommunity(other.token, 'ABC');
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().detail).toBeDefined();
  });

  it('discover excludes my communities, Personal spaces, supports search and counts members', async () => {
    const alex = await account();
    const sam = await account('sam@example.com');
    await createCommunity(alex.token, 'Morning Runners');
    await createCommunity(sam.token, 'Book Club');
    const discover = async (token: string, q = ''): Promise<Array<{ id: string; name: string; member_count: number }>> =>
      (await get(`/api/users/communities/discover?q=${encodeURIComponent(q)}`, token)).json();
    expect((await discover(alex.token)).map(item => item.name)).toEqual(['Book Club']);
    expect((await discover(sam.token)).map(item => item.name)).toEqual(['Morning Runners']);
    expect(await discover(alex.token, 'run')).toEqual([]);
    expect((await discover(sam.token, 'RUN')).map(item => item.name)).toEqual(['Morning Runners']);
    const book = (await discover(alex.token))[0]!;
    await post(`/api/users/communities/${book.id}/join`, alex.token);
    expect(await discover(alex.token)).toEqual([]);
    const late = await account('late@example.com');
    const afterJoin = (await discover(late.token)).find(item => item.id === book.id);
    expect(afterJoin?.member_count).toBe(2);
  });

  it('joins a public community, is idempotent, and returns 404 for Personal spaces and unknown ids', async () => {
    const owner = await account();
    const member = await account('member@example.com');
    const created = (await createCommunity(owner.token, 'Book Club')).json() as Account;
    const join = await post(`/api/users/communities/${created.community.id}/join`, member.token);
    expect(join.statusCode).toBe(200);
    expect(tenantOf(join.json().token)).toBe(created.community.id);
    expect((await post(`/api/users/communities/${created.community.id}/join`, member.token)).statusCode).toBe(200);
    const list = (await get('/api/users/communities', join.json().token)).json() as Array<{ id: string; member_count: number; role: string }>;
    expect(list.find(item => item.id === created.community.id)).toMatchObject({ member_count: 2, role: 'member' });
    expect((await post(`/api/users/communities/${owner.community.id}/join`, member.token)).statusCode).toBe(404);
    expect((await post(`/api/users/communities/${crypto.randomUUID()}/join`, member.token)).statusCode).toBe(404);
  });

  it('applies leave rules: Personal space and last owner are 409, active leave goes to Personal space', async () => {
    const owner = await account();
    const member = await account('member@example.com');
    const created = (await createCommunity(owner.token, 'Book Club')).json() as Account;
    const id = created.community.id;
    expect((await post(`/api/users/communities/${owner.community.id}/leave`, owner.token)).statusCode).toBe(409);
    expect((await post(`/api/users/communities/${id}/leave`, created.token)).statusCode).toBe(409);
    const joined = (await post(`/api/users/communities/${id}/join`, member.token)).json() as Account;
    const left = await post(`/api/users/communities/${id}/leave`, joined.token);
    expect(left.statusCode).toBe(200);
    expect(left.json().community).toMatchObject({ kind: 'personal', id: member.community.id });
    expect(tenantOf(left.json().token)).toBe(member.community.id);
    expect((await post(`/api/users/communities/${id}/leave`, left.json().token)).statusCode).toBe(404);
  });

  it('lets only an owner delete a community, never the Personal space', async () => {
    const owner = await account();
    const member = await account('member@example.com');
    const created = (await createCommunity(owner.token, 'Delete Me')).json() as Account;
    const id = created.community.id;
    const joined = (await post(`/api/users/communities/${id}/join`, member.token)).json() as Account;
    const del = (url: string, token: string) => app.inject({ method: 'DELETE', url, headers: { authorization: `Bearer ${token}` } });
    expect((await del(`/api/users/communities/${id}`, joined.token)).statusCode).toBe(403);
    expect((await del(`/api/users/communities/${owner.community.id}`, owner.token)).statusCode).toBe(409);
    const deleted = await del(`/api/users/communities/${id}`, created.token);
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().community).toMatchObject({ kind: 'personal', id: owner.community.id });
    expect((await del(`/api/users/communities/${id}`, created.token)).statusCode).toBe(404);
    const relogin = await app.inject({ method: 'POST', url: '/api/users/login', payload: { email: 'member@example.com', password: 'Demo-Pass-123' } });
    expect(relogin.json().community.kind).toBe('personal');
  });

  it('leaving a community that is not active keeps the active community', async () => {
    const owner = await account();
    const member = await account('member@example.com');
    const one = (await createCommunity(owner.token, 'Book Club')).json() as Account;
    const two = (await createCommunity(owner.token, 'Chess Club')).json() as Account;
    await post(`/api/users/communities/${one.community.id}/join`, member.token);
    const active = (await post(`/api/users/communities/${two.community.id}/join`, member.token)).json() as Account;
    const left = await post(`/api/users/communities/${one.community.id}/leave`, active.token);
    expect(left.json().community.id).toBe(two.community.id);
  });

  it('switches between communities and answers 403 for non-members and after leaving', async () => {
    const alex = await account();
    const sam = await account('sam@example.com');
    const book = (await createCommunity(sam.token, 'Book Club')).json() as Account;
    const forbidden = await post('/api/users/switch', alex.token, { community_id: book.community.id });
    expect(forbidden.statusCode).toBe(403);
    expect((await post('/api/users/switch', alex.token, { community_id: crypto.randomUUID() })).statusCode).toBe(403);
    const joined = (await post(`/api/users/communities/${book.community.id}/join`, alex.token)).json() as Account;
    const back = await post('/api/users/switch', joined.token, { community_id: alex.community.id });
    expect(back.statusCode).toBe(200);
    expect(tenantOf(back.json().token)).toBe(alex.community.id);
    const forward = await post('/api/users/switch', back.json().token, { community_id: book.community.id });
    expect(forward.json().community.name).toBe('Book Club');
    await post(`/api/users/communities/${book.community.id}/leave`, forward.json().token);
    expect((await post('/api/users/switch', alex.token, { community_id: book.community.id })).statusCode).toBe(403);
    expect((await get('/api/users/me', forward.json().token)).statusCode).toBe(404);
  });

  it('resolves internal lookups only for members of the given community', async () => {
    const alex = await account();
    const sam = await account('sam@example.com');
    const book = (await createCommunity(alex.token, 'Book Club')).json() as Account;
    const internal = { 'x-internal-token': process.env.INTERNAL_TOKEN! };
    const byEmail = (email: string, tenant: string, token: string) => app.inject({ method: 'GET',
      url: `/api/users/internal/users?email=${encodeURIComponent(email)}&tenant_id=${tenant}`, headers: { ...bearer(token), ...internal } });
    expect((await byEmail('sam@example.com', book.community.id, book.token)).statusCode).toBe(404);
    expect((await byEmail('SAM@example.com', sam.community.id, sam.token)).json().id).toBe(sam.user.id);
    await post(`/api/users/communities/${book.community.id}/join`, sam.token);
    const found = await byEmail('sam@example.com', book.community.id, book.token);
    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject({ id: sam.user.id, tenant_id: book.community.id });
    expect((await byEmail('nobody@example.com', book.community.id, book.token)).statusCode).toBe(404);
    const byId = (id: string, token: string) => app.inject({ method: 'GET', url: `/api/users/internal/users/${id}`, headers: { ...bearer(token), ...internal } });
    expect((await byId(sam.user.id, book.token)).statusCode).toBe(200);
    expect((await byId(sam.user.id, alex.token)).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/users/internal/users/${sam.user.id}`, headers: bearer(book.token) })).statusCode).toBe(401);
  });

  it('isolates communities: a token for one community never resolves members of another', async () => {
    const alex = await account();
    const sam = await account('sam@example.com');
    const mismatched = await signToken({ sub: sam.user.id, tenant_id: alex.community.id, email: 'sam@example.com', name: 'Sam' });
    expect((await get('/api/users/me', mismatched)).statusCode).toBe(404);
    const internal = await app.inject({ method: 'GET', url: `/api/users/internal/users/${sam.user.id}`,
      headers: { ...bearer(mismatched), 'x-internal-token': process.env.INTERNAL_TOKEN! } });
    expect(internal.statusCode).toBe(404);
    const docs = await app.inject({ method: 'GET', url: '/api/users/openapi.json' });
    expect(docs.statusCode).toBe(200);
    const paths = Object.keys(docs.json().paths);
    expect(paths).toEqual(expect.arrayContaining(['/api/users/register', '/api/users/communities', '/api/users/communities/discover', '/api/users/switch']));
    expect(paths).not.toContain('/api/users/tenants/{slug}');
    expect((await app.inject({ method: 'GET', url: '/api/users/docs' })).statusCode).toBe(200);
  });

  it('returns identical login failures for unknown emails and wrong passwords', async () => {
    await register();
    const unknown = await app.inject({ method: 'POST', url: '/api/users/login', payload: { email: 'missing@example.com', password: 'bad' } });
    const wrong = await app.inject({ method: 'POST', url: '/api/users/login', payload: { email: 'alex@example.com', password: 'bad' } });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
  });

  it('treats an empty profile patch as a read and updates the name', async () => {
    const acct = await account();
    const empty = await app.inject({ method: 'PATCH', url: '/api/users/me', headers: bearer(acct.token), payload: {} });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({ id: acct.user.id, community: { kind: 'personal' } });
    const renamed = await app.inject({ method: 'PATCH', url: '/api/users/me', headers: bearer(acct.token), payload: { name: ' Alex M ' } });
    expect(renamed.json().name).toBe('Alex M');
    const token = await signToken({ sub: acct.user.id, tenant_id: '11111111-1111-4111-8111-111111111111', email: acct.user.email, name: 'Alex' });
    const missing = await app.inject({ method: 'PATCH', url: '/api/users/me', headers: bearer(token), payload: {} });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ detail: 'User not found' });
  });

  it.each([{}, { email: 'invalid' }, { password: '' }, { name: 123 }, { timezone: null }])(
    'returns a 422 detail response for invalid registration: %j', async change => {
      const payload = Object.keys(change).length ? { email: 'alex@example.com', password: 'Demo-Pass-123', name: 'Alex', ...change } : {};
      const response = await app.inject({ method: 'POST', url: '/api/users/register', payload });
      expect(response.statusCode).toBe(422);
      expect(response.json().detail).toBeDefined();
      expect((await getPool().query('SELECT * FROM "users_test"."users"')).rows).toHaveLength(0);
    }
  );

  it('no longer accepts a community at sign-up and has no tenant lookup route', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/users/register', payload: { email: 'a@example.com', password: 'Demo-Pass-123', name: 'A', tenant_name: 'Team' } });
    expect(response.statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: '/api/users/tenants/nagp-demo' })).statusCode).toBe(404);
  });

  it.each([{ name: '' }, { name: null }, { name: 123 }, { timezone: null }, { email: 'other@example.com' }])(
    'rejects invalid profile patches without changing the profile: %j', async payload => {
      const acct = await account();
      const response = await app.inject({ method: 'PATCH', url: '/api/users/me', headers: bearer(acct.token), payload });
      expect(response.statusCode).toBe(422);
      expect(response.json().detail).toBeDefined();
      expect((await get('/api/users/me', acct.token)).json()).toMatchObject({ id: acct.user.id, email: acct.user.email });
    }
  );

  it.each(['', 'x'.repeat(73), 'é'.repeat(37)])('returns the same 401 for invalid login password lengths', async password => {
    await register();
    for (const email of ['alex@example.com', 'unknown@example.com']) {
      const response = await app.inject({ method: 'POST', url: '/api/users/login', payload: { email, password } });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ detail: 'Invalid email or password' });
    }
  });

  it('issues HS256 tokens with the shared claim names and a 60 minute expiry', async () => {
    const acct = await account();
    const claims = decodeJwt(acct.token);
    expect(decodeProtectedHeader(acct.token).alg).toBe('HS256');
    expect(Object.keys(claims).sort()).toEqual(['email', 'exp', 'iat', 'name', 'sub', 'tenant_id']);
    expect(claims).toMatchObject({ sub: acct.user.id, tenant_id: acct.community.id, email: acct.user.email });
    expect(claims.exp! - claims.iat!).toBe(3600);
  });

  it.each([{ email: '' }, { name: ' ' }, { iat: Math.floor(Date.now() / 1000) + 3600 }])(
    'rejects invalid identity claims: %j', async change => {
      const acct = await account();
      const token = await new SignJWT({ ...decodeJwt(acct.token), ...change })
        .setProtectedHeader({ alg: 'HS256' }).sign(getConfig().jwtSecret);
      await expect(verifyToken(token)).rejects.toThrow();
    }
  );

  it('requires a token for community endpoints', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/users/communities' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/users/switch', payload: { community_id: crypto.randomUUID() } })).statusCode).toBe(401);
  });

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
