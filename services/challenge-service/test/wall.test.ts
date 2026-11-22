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
  let ownerToken: string; let friendToken: string; let foreignToken: string;
  const auth = (token = ownerToken) => ({ authorization: `Bearer ${token}` });
  beforeAll(async () => {
    app = await createApp('wall-test', '/api/challenges');
    await app.register(async service => registerChallengeRoutes(service), { prefix: '/api/challenges' }); await app.ready(); await initializeChallengeTables();
    ownerToken = await signToken({ sub: owner, tenant_id: tenant, email: 'owner@example.com', name: 'Owner' });
    friendToken = await signToken({ sub: friend, tenant_id: tenant, email: 'friend@example.com', name: 'Friend' });
    foreignToken = await signToken({ sub: friend, tenant_id: otherTenant, email: 'friend@example.com', name: 'Friend' });
  });
  beforeEach(async () => {
    for (const table of ['post_comments', 'post_likes', 'posts', 'participants', 'challenges']) await getPool().query(`DELETE FROM "challenges_test"."${table}"`);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => new Response(JSON.stringify({ name: String(input).endsWith(owner) ? 'Owner Name' : 'Friend Name' }), { status: 200 }));
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

  it('lists newest first with author name, image and value chip, and pages by 10', async () => {
    await create('First', 'public', { image_url: '/posts/a.jpg', caring_value: 'Responsible' });
    for (let i = 2; i <= 12; i++) { await new Promise(resolve => setTimeout(resolve, 3)); await create(`Post ${i}`); }
    const first = await wall();
    expect(first.posts).toHaveLength(10); expect(first.posts[0]).toMatchObject({ caption: 'About Post 12', author_name: 'Owner Name', participant_count: 1, joined_by_me: true });
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
});
