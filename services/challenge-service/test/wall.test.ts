import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp, getPool, signToken } from '@habitloop/shared';
import { initializeChallengeTables } from '../src/db/init.js';
import { registerChallengeRoutes } from '../src/routes/challenges.js';

describe('Home wall', () => {
  let app: FastifyInstance;
  const tenant = '11111111-1111-4111-8111-111111111111';
  const otherTenant = '33333333-3333-4333-8333-333333333333';
  const owner = '22222222-2222-4222-8222-222222222222';
  const friend = '44444444-4444-4444-8444-444444444444';
  const stranger = '55555555-5555-4555-8555-555555555555';
  let members: Record<string, string[]> = {};
  let ownerToken: string; let friendToken: string; let foreignToken: string;
  const auth = (token = ownerToken) => ({ authorization: `Bearer ${token}` });
  beforeAll(async () => {
    app = await createApp('wall-test', '/api/challenges');
    await app.register(async service => registerChallengeRoutes(service), { prefix: '/api/challenges' }); await app.ready(); await initializeChallengeTables();
    ownerToken = await signToken({ sub: owner, tenant_id: tenant, email: 'owner@example.com', name: 'Owner' });
    friendToken = await signToken({ sub: friend, tenant_id: tenant, email: 'friend@example.com', name: 'Friend' });
    foreignToken = await signToken({ sub: stranger, tenant_id: otherTenant, email: 'stranger@example.com', name: 'Stranger' });
  });
  beforeEach(async () => {
    for (const table of ['post_comments', 'post_likes', 'posts', 'participants', 'challenges']) await getPool().query(`DELETE FROM "challenges_test"."${table}"`);
    members = { [owner]: [tenant], [friend]: [tenant], [stranger]: [otherTenant] };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); const communities = /\/internal\/users\/([0-9a-f-]+)\/communities$/.exec(url);
      if (communities) return new Response(JSON.stringify((members[communities[1]!] ?? []).map(id => ({ id, name: id === tenant ? 'Alpha' : 'Beta', kind: 'community' }))), { status: 200 });
      return new Response(JSON.stringify({ name: url.endsWith(owner) ? 'Owner Name' : 'Friend Name' }), { status: 200 });
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });
  afterAll(async () => { await app.close(); });
  async function create(title: string, visibility: 'public' | 'members' = 'public', extra: Record<string, unknown> = {}) {
    const response = await app.inject({ method: 'POST', url: '/api/challenges', headers: auth(), payload: { title, description: `About ${title}`, visibility, activity_category: 'fitness', start_date: '2026-11-01', end_date: '2026-12-31', target_count: 10, ...extra } });
    expect(response.statusCode, response.body).toBe(201); return response.json() as { id: string };
  }
  async function wall(cursor?: string, token = ownerToken) {
    const response = await app.inject({ method: 'GET', url: `/api/challenges/wall${cursor ? `?cursor=${cursor}` : ''}`, headers: auth(token) });
    expect(response.statusCode, response.body).toBe(200); return response.json() as { posts: Record<string, any>[]; next_cursor: string | null }; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads loose JSON
  }
  async function firstPostId(): Promise<string> { return (await wall()).posts[0]!.id as string; }

  it('lists newest first with optional legacy value metadata, and pages by 10', async () => {
    await create('First', 'public', { image_url: '/posts/a.jpg', caring_value: 'Responsible' });
    for (let i = 2; i <= 12; i++) { await new Promise(resolve => setTimeout(resolve, 3)); await create(`Post ${i}`); }
    const first = await wall();
    expect(first.posts).toHaveLength(10); expect(first.posts[0]).toMatchObject({ caption: 'About Post 12', author_name: 'Owner Name', participant_count: 1, joined_by_me: true, caring_value: null });
    expect(first.next_cursor).toBeTruthy();
    const second = await wall(first.next_cursor!);
    expect(second.posts.map(row => row.challenge.title)).toEqual(['Post 2', 'First']);
    expect(second.posts[1]).toMatchObject({ image_url: '/posts/a.jpg', caring_value: 'Responsible' }); expect(second.next_cursor).toBeNull();
    expect((await wall(undefined, friendToken)).posts[0]!.joined_by_me).toBe(false);
  });
  it('shows members-only posts to members, flags the owner, and hides other communities', async () => {
    await create('Secret', 'members'); await create('Open');
    expect((await wall()).posts.map(row => row.challenge.title).sort()).toEqual(['Open', 'Secret']);
    expect((await wall()).posts.every(row => row.owned_by_me)).toBe(true);
    expect((await wall(undefined, friendToken)).posts.some(row => row.owned_by_me)).toBe(false);
    expect((await wall(undefined, foreignToken)).posts).toEqual([]);
    const secret = (await getPool().query("SELECT p.id FROM \"challenges_test\".\"posts\" p JOIN \"challenges_test\".\"challenges\" c ON c.id = p.challenge_id WHERE c.visibility = 'members'")).rows[0].id;
    expect((await app.inject({ method: 'POST', url: `/api/challenges/wall/${secret}/like`, headers: auth(foreignToken) })).statusCode).toBe(404);
  });
  it('toggles likes without duplicates', async () => {
    await create('Likeable'); const id = await firstPostId();
    const like = () => app.inject({ method: 'POST', url: `/api/challenges/wall/${id}/like`, headers: auth(friendToken) });
    expect((await like()).json()).toEqual({ like_count: 1, liked_by_me: true });
    expect((await app.inject({ method: 'POST', url: `/api/challenges/wall/${id}/like`, headers: auth() })).json()).toEqual({ like_count: 2, liked_by_me: true });
    expect((await like()).json()).toEqual({ like_count: 1, liked_by_me: false });
    expect((await like()).json()).toEqual({ like_count: 2, liked_by_me: true });
    const row = (await wall(undefined, friendToken)).posts[0]!; expect(row).toMatchObject({ like_count: 2, liked_by_me: true });
  });
  it('validates comments and returns the latest two with a total', async () => {
    await create('Chatty'); const id = await firstPostId(); const url = `/api/challenges/wall/${id}/comments`;
    for (const body of ['', '   ', 'x'.repeat(1001)]) expect((await app.inject({ method: 'POST', url, headers: auth(friendToken), payload: { body } })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await app.inject({ method: 'POST', url, headers: auth(friendToken), payload: {} })).statusCode).toBe(422);
    for (const body of ['one', ' two ', 'three']) { await new Promise(resolve => setTimeout(resolve, 3)); expect((await app.inject({ method: 'POST', url, headers: auth(friendToken), payload: { body } })).statusCode).toBe(201); }
    const row = (await wall()).posts[0]!;
    expect(row.comment_count).toBe(3); expect(row.latest_comments.map((comment: { body: string }) => comment.body)).toEqual(['three', 'two']);
    const all = (await app.inject({ method: 'GET', url, headers: auth() })).json() as { body: string; author_name: string }[];
    expect(all.map(comment => comment.body)).toEqual(['one', 'two', 'three']); expect(all[0]!.author_name).toBe('Friend Name');
  });
  it('lets only the author delete a comment, and hides it from other communities', async () => {
    await create('Moderated'); const id = await firstPostId();
    const created = await app.inject({ method: 'POST', url: `/api/challenges/wall/${id}/comments`, headers: auth(friendToken), payload: { body: 'hello' } });
    const commentId = created.json().id as string; const url = `/api/challenges/wall/comments/${commentId}`;
    expect((await app.inject({ method: 'DELETE', url, headers: auth() })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url, headers: auth(foreignToken) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url, headers: auth(friendToken) })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url, headers: auth(friendToken) })).statusCode).toBe(404);
  });
  it('returns 404 for post actions from another community', async () => {
    await create('Walled'); const id = await firstPostId();
    expect((await app.inject({ method: 'POST', url: `/api/challenges/wall/${id}/like`, headers: auth(foreignToken) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/challenges/wall/${id}/comments`, headers: auth(foreignToken) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/challenges/wall/${id}/comments`, headers: auth(foreignToken), payload: { body: 'hi' } })).statusCode).toBe(404);
  });
  it('merges posts of every community I belong to, filters by community, and excludes others', async () => {
    await create('In Alpha');
    const ownerBeta = await signToken({ sub: owner, tenant_id: otherTenant, email: 'owner@example.com', name: 'Owner' });
    members[owner] = [tenant, otherTenant];
    const beta = await app.inject({ method: 'POST', url: '/api/challenges', headers: auth(ownerBeta), payload: { title: 'In Beta', visibility: 'members', activity_category: 'fitness', start_date: '2026-11-01', end_date: '2026-12-31', target_count: 5 } });
    expect(beta.statusCode, beta.body).toBe(201);
    const merged = (await wall()).posts;
    expect(merged.map(row => [row.challenge.title, row.community.name])).toEqual([['In Beta', 'Beta'], ['In Alpha', 'Alpha']]);
    expect((await app.inject({ method: 'GET', url: `/api/challenges/wall?community_id=${tenant}`, headers: auth() })).json().posts).toHaveLength(1);
    // The friend belongs to Alpha only: Beta posts never appear, and a members-only Beta post is hidden from a non-member filter.
    expect((await wall(undefined, friendToken)).posts.map(row => row.challenge.title)).toEqual(['In Alpha']);
    const filtered = await app.inject({ method: 'GET', url: `/api/challenges/wall?community_id=${otherTenant}`, headers: auth(friendToken) });
    expect(filtered.json().posts).toEqual([]);
  });
  it('lets like and comment work from any member community, and answers 404 for a non-member', async () => {
    const ownerBeta = await signToken({ sub: owner, tenant_id: otherTenant, email: 'owner@example.com', name: 'Owner' });
    members[owner] = [tenant, otherTenant]; members[friend] = [tenant, otherTenant];
    const made = await app.inject({ method: 'POST', url: '/api/challenges', headers: auth(ownerBeta), payload: { title: 'Elsewhere', activity_category: 'fitness', start_date: '2026-11-01', end_date: '2026-12-31', target_count: 5 } });
    expect(made.statusCode, made.body).toBe(201);
    const id = (await wall()).posts[0]!.id as string;
    // friend's active community is Alpha, the post lives in Beta
    expect((await app.inject({ method: 'POST', url: `/api/challenges/wall/${id}/like`, headers: auth(friendToken) })).json()).toEqual({ like_count: 1, liked_by_me: true });
    expect((await app.inject({ method: 'POST', url: `/api/challenges/wall/${id}/comments`, headers: auth(friendToken), payload: { body: 'across' } })).statusCode).toBe(201);
    const challengeId = (await wall(undefined, friendToken)).posts[0]!.challenge.id as string;
    expect((await app.inject({ method: 'POST', url: `/api/challenges/${challengeId}/join`, headers: auth(friendToken) })).statusCode).toBe(200);
    members[friend] = [tenant];
    expect((await app.inject({ method: 'POST', url: `/api/challenges/wall/${id}/like`, headers: auth(friendToken) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/challenges/wall/${id}/comments`, headers: auth(friendToken), payload: { body: 'no' } })).statusCode).toBe(404);
  });
  it('creates a challenge in a chosen community and rejects one the user is not in', async () => {
    const make = (communityId: string) => app.inject({ method: 'POST', url: '/api/challenges', headers: auth(), payload: { community_id: communityId, title: 'Chosen', activity_category: 'fitness', start_date: '2026-11-01', end_date: '2026-12-31', target_count: 5 } });
    members[owner] = [tenant, otherTenant];
    expect((await make(otherTenant)).json()).toMatchObject({ tenant_id: otherTenant });
    members[owner] = [tenant];
    expect((await make(otherTenant)).statusCode).toBe(403);
  });
});
