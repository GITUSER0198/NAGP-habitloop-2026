import * as crypto from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { createApp, getPool, signToken } from '@habitloop/shared';
import { initializeChallengeTables } from '../src/db/init.js';
import { registerChallengeRoutes } from '../src/routes/challenges.js';

vi.mock('node:crypto', async importOriginal => {
  const original = await importOriginal<typeof import('node:crypto')>();
  return { ...original, randomBytes: vi.fn(original.randomBytes) };
});

describe('Python challenge contract parity', () => {
  const prefix = '/api/challenges'; const tenant = crypto.randomUUID(); const owner = crypto.randomUUID(); const peer = crypto.randomUUID(); const foreignTenant = crypto.randomUUID(); const foreignUser = crypto.randomUUID();
  let app: FastifyInstance; let auth: Record<string, string>; let peerAuth: Record<string, string>; let foreign: Record<string, string>; let sameUserForeign: Record<string, string>;
  const secret = { 'x-internal-token': process.env.INTERNAL_TOKEN! };
  let lookupStatus: number; let emailPayload: unknown; const missing = new Set<string>(); const emails = new Map<string, string>();
  const requests: { url: URL; headers: Headers }[] = [];
  const call = (method: InjectOptions['method'], path = '', payload?: unknown, headers = auth) => app.inject({ method, url: prefix + path, headers: { ...headers, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) }, ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }) });
  async function create(changes: Record<string, unknown> = {}, headers = auth) {
    const result = await call('POST', '', { title: ' Run ', activity_category: ' fitness ', start_date: '2026-11-01', end_date: '2026-12-01', target_count: 10, ...changes }, headers);
    expect(result.statusCode, result.body).toBe(201); return result.json();
  }
  async function invite(id: string, payload: unknown = { user_ids: [peer] }) {
    const result = await call('POST', `/${id}/invites`, payload); expect(result.statusCode, result.body).toBe(200); return result.json();
  }
  const ids = (items: { id: string }[]) => items.map(item => item.id);
  function publicShape(created: Record<string, unknown>) { const { invite_code, ...rest } = created; return rest; }
  async function setTime(value: string) {
    vi.setSystemTime(new Date(value));
    const token = async (sub: string, tenant_id: string) => ({ authorization: `Bearer ${await signToken({ sub, tenant_id, email: 'test@example.com', name: 'Test' })}` });
    auth = await token(owner, tenant); peerAuth = await token(peer, tenant); foreign = await token(foreignUser, foreignTenant); sameUserForeign = await token(peer, foreignTenant);
  }
  beforeAll(async () => {
    app = await createApp('challenge-service', prefix); await app.register(registerChallengeRoutes, { prefix }); await app.ready(); await initializeChallengeTables();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM "challenges_test"."participants"'); await getPool().query('DELETE FROM "challenges_test"."challenges"');
    vi.useFakeTimers({ toFake: ['Date'] }); await setTime('2026-11-21T12:00:00Z');
    lookupStatus = 200; emailPayload = undefined; missing.clear(); emails.clear(); requests.length = 0; emails.set('peer@example.com', peer);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
      const url = new URL(String(input)); requests.push({ url, headers: new Headers(options?.headers) });
      if (lookupStatus !== 200) return Response.json({}, { status: lookupStatus });
      if (url.searchParams.has('email')) { const id = emails.get(url.searchParams.get('email')!); return Response.json(emailPayload ?? (id ? { id, tenant_id: tenant } : {}), { status: id ? 200 : 404 }); }
      return Response.json({}, { status: missing.has(url.pathname.split('/').at(-1)!) ? 404 : 200 });
    });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  afterAll(async () => { await app.close(); });

  it('creates and scopes feeds and private visibility without leaking invite codes', async () => {
    const publicItem = await create(); const privateItem = await create({ visibility: 'private' });
    expect(publicItem).toEqual({ id: publicItem.id, tenant_id: tenant, owner_id: owner, title: 'Run', description: '', visibility: 'public', invite_code: expect.stringMatching(/^[A-Z0-9]{8}$/), activity_category: 'fitness', start_date: '2026-11-01', end_date: '2026-12-01', target_count: 10 });
    expect(ids((await call('GET', '/feed')).json()).sort()).toEqual([publicItem.id, privateItem.id].sort());
    expect((await call('GET', '/feed', undefined, peerAuth)).json()).toEqual([publicShape(publicItem)]);
    const visible = await call('GET', `/${publicItem.id}`, undefined, peerAuth); expect(visible.statusCode).toBe(200); expect(visible.json()).toEqual(publicShape(publicItem));
    expect((await call('GET', `/${privateItem.id}`, undefined, peerAuth)).statusCode).toBe(404);
    expect((await call('POST', `/${privateItem.id}/join`, undefined, peerAuth)).statusCode).toBe(404);
    expect((await call('GET', `/${crypto.randomUUID()}`)).statusCode).toBe(404);
  });
  it('joins, leaves, rejoins and preserves participant response shape and idempotency', async () => {
    const challenge = await create(); const path = `/${challenge.id}`;
    const joined = await call('POST', `${path}/join`, undefined, peerAuth); expect(joined.statusCode).toBe(200);
    expect(joined.json()).toEqual({ challenge_id: challenge.id, user_id: peer, tenant_id: tenant, status: 'joined', joined_at: expect.stringMatching(/Z$/) });
    expect((await call('POST', `${path}/join`, undefined, peerAuth)).json()).toEqual(joined.json());
    const left = await call('POST', `${path}/leave`, undefined, peerAuth); expect(left.statusCode).toBe(200); expect(left.json().status).toBe('left');
    expect((await call('POST', `${path}/leave`, undefined, peerAuth)).json()).toEqual(left.json());
    expect((await call('POST', `${path}/join`, undefined, peerAuth)).json().status).toBe('joined');
  });
  it('handles simultaneous public and code joins without duplicate participation', async () => {
    const challenge = await create(); const results = await Promise.all([
      call('POST', `/${challenge.id}/join`, undefined, peerAuth),
      call('POST', '/join-by-code', { invite_code: challenge.invite_code }, peerAuth),
    ]);
    expect(results.map(result => result.statusCode)).toEqual([200, 200]); expect(results[0].json()).toEqual(results[1].json());
    expect((await getPool().query('SELECT * FROM "challenges_test"."participants" WHERE user_id=$1', [peer])).rows).toHaveLength(1);
  });
  it('accepts empty JSON request bodies for membership and code-only invite routes', async () => {
    const challenge = await create(); const headers = { ...peerAuth, 'content-type': 'application/json' };
    const join = await call('POST', `/${challenge.id}/join`, undefined, headers); expect(join.statusCode, join.body).toBe(200);
    expect((await call('POST', `/${challenge.id}/leave`, undefined, headers)).statusCode).toBe(200);
    expect((await call('POST', `/${challenge.id}/invites`, undefined, { ...auth, 'content-type': 'application/json' })).statusCode).toBe(200);
    const missing = await call('POST', '', undefined, { ...auth, 'content-type': 'application/json' }); expect(missing.statusCode).toBe(422);
    const malformed = await app.inject({ method: 'POST', url: prefix, headers: { ...auth, 'content-type': 'application/json' }, payload: '{' }); expect(malformed.statusCode).toBe(422); expect(malformed.json().detail[0].type).toBe('json_invalid');
  });
  it('invites privately, forwards lookup credentials, accepts twice and keeps a single membership', async () => {
    const challenge = await create({ visibility: 'private' }); expect(await invite(challenge.id)).toEqual({ invite_code: challenge.invite_code, user_ids: [peer] });
    expect(requests[0].url.pathname).toBe(`/api/users/internal/users/${peer}`); expect(requests[0].headers.get('authorization')).toBe(auth.authorization); expect(requests[0].headers.get('x-internal-token')).toBe(secret['x-internal-token']);
    for (const path of ['/invites', '/feed']) expect((await call('GET', path, undefined, peerAuth)).json()).toEqual([publicShape(challenge)]);
    expect((await call('GET', `/${challenge.id}`, undefined, peerAuth)).statusCode).toBe(200);
    expect((await call('POST', `/${challenge.id}/join`, undefined, peerAuth)).statusCode).toBe(409);
    const path = `/invites/${challenge.id}/accept`; const accepted = await call('POST', path, undefined, peerAuth); expect(accepted.statusCode).toBe(200); expect(accepted.json().status).toBe('joined');
    expect((await call('POST', path, undefined, peerAuth)).json()).toEqual(accepted.json());
    expect((await call('GET', '/invites', undefined, peerAuth)).json()).toEqual([]); await invite(challenge.id);
    expect((await call('GET', '/invites', undefined, peerAuth)).json()).toEqual([]);
    expect((await getPool().query('SELECT * FROM "challenges_test"."participants" WHERE user_id=$1', [peer])).rows).toHaveLength(1);
  });
  it('declines, reinvites and hides private challenges after decline and leave', async () => {
    const challenge = await create({ visibility: 'private' }); await invite(challenge.id); const path = `/${challenge.id}`; const decline = `/invites/${challenge.id}/decline`; const accept = `/invites/${challenge.id}/accept`;
    const declined = await call('POST', decline, undefined, peerAuth); expect(declined.statusCode).toBe(200); expect(declined.json().status).toBe('declined'); expect((await call('POST', decline, undefined, peerAuth)).json()).toEqual(declined.json());
    for (const endpoint of ['/invites', '/feed']) expect((await call('GET', endpoint, undefined, peerAuth)).json()).toEqual([]);
    expect((await call('GET', path, undefined, peerAuth)).statusCode).toBe(404); expect((await call('POST', accept, undefined, peerAuth)).statusCode).toBe(404);
    await invite(challenge.id); expect((await call('POST', accept, undefined, peerAuth)).statusCode).toBe(200); expect((await call('POST', decline, undefined, peerAuth)).statusCode).toBe(409);
    expect((await call('POST', `${path}/leave`, undefined, peerAuth)).json().status).toBe('left'); expect((await call('GET', path, undefined, peerAuth)).statusCode).toBe(404); expect((await call('GET', '/feed', undefined, peerAuth)).json()).toEqual([]);
    await invite(challenge.id); expect((await call('POST', accept, undefined, peerAuth)).statusCode).toBe(200);
  });
  it('supports code-only invitations, absent or null bodies, private code joins and leave', async () => {
    const challenge = await create({ visibility: 'private' }); const expected = { invite_code: challenge.invite_code, user_ids: [] };
    for (const body of [{}, undefined, null]) expect((await call('POST', `/${challenge.id}/invites`, body)).json()).toEqual(expected);
    const joined = await call('POST', '/join-by-code', { invite_code: challenge.invite_code }, peerAuth); expect(joined.statusCode).toBe(200); expect(joined.json().status).toBe('joined');
    expect((await call('POST', '/join-by-code', { invite_code: ` ${challenge.invite_code} ` }, peerAuth)).json()).toEqual(joined.json());
    expect((await call('GET', `/${challenge.id}`, undefined, peerAuth)).statusCode).toBe(200);
    expect((await call('POST', `/${challenge.id}/leave`, undefined, peerAuth)).statusCode).toBe(200); expect((await call('GET', `/${challenge.id}`, undefined, peerAuth)).statusCode).toBe(404);
  });
  it.each(['public', 'private'])('rejects every ended join path for %s and accepts twice across expiration', async visibility => {
    const challenge = await create({ visibility }); await invite(challenge.id); await setTime('2026-12-02T12:00:00Z');
    for (const [path, body, headers] of [['/join-by-code', { invite_code: challenge.invite_code }, peerAuth], [`/invites/${challenge.id}/accept`, undefined, peerAuth], [`/${challenge.id}/join`, undefined, peerAuth], [`/${challenge.id}/invites`, {}, auth]] as const)
      expect((await call('POST', path, body, headers)).statusCode).toBe(409);
    await setTime('2026-12-01T12:00:00Z'); const accepted = await call('POST', `/invites/${challenge.id}/accept`, undefined, peerAuth); expect(accepted.statusCode).toBe(200);
    await setTime('2026-12-02T12:00:00Z'); expect((await call('POST', `/invites/${challenge.id}/accept`, undefined, peerAuth)).json()).toEqual(accepted.json());
  });
  it.each(['public', 'private'])('isolates every resource and code across tenants for %s', async visibility => {
    const challenge = await create({ visibility }); await invite(challenge.id);
    for (const headers of [foreign, sameUserForeign]) {
      expect((await call('GET', `/${challenge.id}`, undefined, headers)).statusCode).toBe(404);
      for (const suffix of ['join', 'leave', 'invites']) expect((await call('POST', `/${challenge.id}/${suffix}`, suffix === 'invites' ? { user_ids: [foreignUser] } : undefined, headers)).statusCode).toBe(404);
      for (const action of ['accept', 'decline']) expect((await call('POST', `/invites/${challenge.id}/${action}`, undefined, headers)).statusCode).toBe(404);
      expect((await call('POST', '/join-by-code', { invite_code: challenge.invite_code }, headers)).statusCode).toBe(404);
      for (const path of ['/feed', '/invites']) expect((await call('GET', path, undefined, headers)).json()).toEqual([]);
    }
    const result = await call('GET', `/internal/users/${owner}/active`, undefined, { ...foreign, ...secret }); expect(result.statusCode).toBe(200); expect(result.json()).toEqual([]);
  });
  it('checks invite ownership and missing memberships', async () => {
    const challenge = await create(); expect((await call('POST', `/${challenge.id}/invites`, {}, peerAuth)).statusCode).toBe(403);
    expect((await call('POST', `/${challenge.id}/leave`, undefined, peerAuth)).statusCode).toBe(404);
    for (const action of ['accept', 'decline']) expect((await call('POST', `/invites/${challenge.id}/${action}`, undefined, peerAuth)).statusCode).toBe(404);
    expect((await call('POST', `/${crypto.randomUUID()}/invites`, {})).statusCode).toBe(404);
  });
  it('validates all recipients before writing and deduplicates user ids', async () => {
    const challenge = await create(); missing.add(foreignUser);
    expect((await call('POST', `/${challenge.id}/invites`, { user_ids: [peer, foreignUser] })).statusCode).toBe(404); expect((await call('GET', '/invites', undefined, peerAuth)).json()).toEqual([]);
    lookupStatus = 503; expect((await call('POST', `/${challenge.id}/invites`, { user_ids: [peer] })).statusCode).toBe(503); expect((await call('GET', '/invites', undefined, peerAuth)).json()).toEqual([]);
    lookupStatus = 200; expect(await invite(challenge.id, { user_ids: [peer.toUpperCase(), peer] })).toMatchObject({ user_ids: [peer] }); expect((await call('GET', '/invites', undefined, peerAuth)).json()).toHaveLength(1);
  });
  it('resolves email invites atomically, case-insensitively, deduplicating both inputs', async () => {
    const challenge = await create({ visibility: 'private' }); const path = `/${challenge.id}/invites`;
    for (const email of ['unknown@example.com', 'foreign@example.com']) { const result = await call('POST', path, { emails: ['peer@example.com', email] }); expect(result.statusCode).toBe(404); expect(result.json().detail).toContain(email); expect((await call('GET', '/invites', undefined, peerAuth)).json()).toEqual([]); }
    expect((await call('POST', path, { emails: ['peer@example.com'] }, foreign)).statusCode).toBe(404);
    expect((await call('POST', path, { emails: ['bad-email'] })).statusCode).toBe(422);
    lookupStatus = 503; expect((await call('POST', path, { emails: ['peer@example.com'] })).statusCode).toBe(503); expect((await call('GET', '/invites', undefined, peerAuth)).json()).toEqual([]);
    lookupStatus = 200; const result = await invite(challenge.id, { emails: ['PEER@example.com', 'peer@example.com'], user_ids: [peer] }); expect(result.user_ids).toEqual([peer]);
    const lookup = requests.at(-1)!; expect(lookup.url.searchParams.get('email')).toBe('peer@example.com'); expect(lookup.headers.get('authorization')).toBe(auth.authorization); expect(lookup.headers.get('x-internal-token')).toBe(secret['x-internal-token']);
    await invite(challenge.id, { emails: ['peer@example.com'] }); expect((await call('GET', '/invites', undefined, peerAuth)).json()).toHaveLength(1);
  });
  it.each([{}, { id: 'invalid' }, { id: null }])('fails malformed email lookup %j without partial invites', async payload => {
    const challenge = await create(); emailPayload = payload;
    const result = await call('POST', `/${challenge.id}/invites`, { user_ids: [peer], emails: ['peer@example.com'] }); expect(result.statusCode).toBe(503); expect((await call('GET', '/invites', undefined, peerAuth)).json()).toEqual([]);
  });
  it('filters internal active challenges by dates, category, membership and tenant', async () => {
    const active = await create({ start_date: '2026-11-21', end_date: '2026-11-21' }); const mind = await create({ activity_category: 'mind' });
    await create({ start_date: '2026-11-22' }); await create({ start_date: '2026-11-19', end_date: '2026-11-20' });
    const path = `/internal/users/${owner}/active`; const headers = { ...auth, ...secret };
    expect((await call('GET', path, undefined, headers)).json().sort()).toEqual([active.id, mind.id].sort());
    expect((await call('GET', `${path}?category=fitness`, undefined, headers)).json()).toEqual([active.id]); expect((await call('GET', `${path}?category=missing`, undefined, headers)).json()).toEqual([]);
    const peerPath = `/internal/users/${peer}/active`;
    expect((await call('GET', peerPath, undefined, headers)).json()).toEqual([]); await invite(active.id); expect((await call('GET', peerPath, undefined, headers)).json()).toEqual([]);
    await call('POST', `/invites/${active.id}/decline`, undefined, peerAuth); expect((await call('GET', peerPath, undefined, headers)).json()).toEqual([]);
    await call('POST', `/${active.id}/join`, undefined, peerAuth); expect((await call('GET', peerPath, undefined, headers)).json()).toEqual([active.id]);
    await call('POST', `/${active.id}/leave`, undefined, peerAuth); expect((await call('GET', peerPath, undefined, headers)).json()).toEqual([]);
    for (const invalid of [auth, secret, { ...auth, 'x-internal-token': 'invalid' }]) expect((await call('GET', path, undefined, invalid)).statusCode).toBe(401);
  });
  it('retries invite-code collisions, scopes codes by tenant and leaves no rows on exhaustion', async () => {
    const code = vi.spyOn(crypto, 'randomBytes'); code.mockReturnValue(Buffer.from('ABCDEF') as never); const first = await create();
    code.mockReturnValueOnce(Buffer.from('ABCDEF') as never).mockReturnValueOnce(Buffer.from('UVWXYZ') as never); const second = await create(); expect(second.invite_code).not.toBe(first.invite_code);
    code.mockReturnValue(Buffer.from('ABCDEF') as never); const other = await create({ visibility: 'private' }, foreign); expect(other.invite_code).toBe(first.invite_code);
    const joined = await call('POST', '/join-by-code', { invite_code: first.invite_code }, foreign); expect(joined.statusCode).toBe(200); expect(joined.json().challenge_id).toBe(other.id);
    const result = await call('POST', '', { title: 'Run', activity_category: 'fitness', start_date: '2026-11-01', end_date: '2026-12-01', target_count: 1 }); expect(result.statusCode).toBe(503); expect((await call('GET', '/feed')).json()).toHaveLength(2);
  });
  it.each([{ title: ' ' }, { visibility: 'secret' }, { activity_category: ' ' }, { target_count: 0 }, { target_count: true }, { start_date: 'invalid' }, { start_date: '2030-01-02', end_date: '2030-01-01' }, { tenant_id: tenant }])('rejects invalid creation %j', async changes => {
    expect((await call('POST', '', { title: 'Run', activity_category: 'fitness', start_date: '2030-01-01', end_date: '2030-01-02', target_count: 1, ...changes })).statusCode).toBe(422);
  });
  it.each(['short', '123456789', 'abcdefgh', '!!!!!!!!', ''])('rejects invalid invite code %j', async invite_code => { expect((await call('POST', '/join-by-code', { invite_code })).statusCode).toBe(422); });
  it('rejects unknown codes and invalid recipients', async () => {
    expect((await call('POST', '/join-by-code', { invite_code: '00000000' })).statusCode).toBe(404); const challenge = await create(); expect((await call('POST', `/${challenge.id}/invites`, { user_ids: ['invalid'] })).statusCode).toBe(422);
  });
  it('requires authentication on every public route before validation', async () => {
    const challenge = await create();
    for (const path of ['/feed', '/invites', `/${challenge.id}`]) expect((await call('GET', path, undefined, {})).statusCode).toBe(401);
    for (const [path, body] of [['', {}], [`/${challenge.id}/join`, undefined], [`/${challenge.id}/leave`, undefined], [`/${challenge.id}/invites`, {}], ['/join-by-code', { invite_code: challenge.invite_code }], [`/invites/${challenge.id}/accept`, undefined], [`/invites/${challenge.id}/decline`, undefined]] as const) expect((await call('POST', path, body, {})).statusCode).toBe(401);
  });
  it('accepts the gateway collection slash', async () => {
    expect((await call('POST', '/', { title: 'Run', activity_category: 'fitness', start_date: '2026-11-21', end_date: '2026-11-21', target_count: 1 })).statusCode).toBe(201);
  });
  it('serves both health paths, request ids and documentation', async () => {
    for (const path of ['/health', `${prefix}/health`]) { const result = await app.inject(path); expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ status: 'ok', service: 'challenge-service' }); expect(result.headers['x-request-id']).toBeTruthy(); }
    for (const path of ['/docs', `${prefix}/docs`, `${prefix}/openapi.json`]) expect((await app.inject(path)).statusCode).toBe(200);
  });
  it('returns validation lists for malformed paths and requests', async () => {
    const result = await call('POST', '/join-by-code', { invite_code: 'short' }); expect(result.statusCode).toBe(422);
    expect(result.json().detail).toEqual(expect.arrayContaining([expect.objectContaining({ loc: ['body', 'invite_code'], msg: expect.any(String), type: expect.any(String) })]));
    const path = await call('GET', '/invalid-id'); expect(path.statusCode).toBe(422); expect(path.json().detail[0].loc).toEqual(['path', 'id']);
  });
});
