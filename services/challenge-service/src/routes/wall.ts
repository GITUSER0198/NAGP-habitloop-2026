import { randomUUID } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, count, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { getConfig, getDb, requireUser } from '@habitloop/shared';
import { challenges, participants, postComments, postLikes, posts } from '../db/schema.js';
import { memberCommunities } from './membership.js';

const PAGE_SIZE = 10;
const Uuid = Type.String({ format: 'uuid' });
const CommentBody = Type.Object({ body: Type.String({ minLength: 1, maxLength: 1000 }) }, { additionalProperties: false });
type Identity = { userId: string; tenantId: string };
type Names = Map<string, string>;
type CommentRow = typeof postComments.$inferSelect;

function fail(statusCode: number, message: string): never { throw Object.assign(new Error(message), { statusCode }); }
function idn(request: FastifyRequest): Identity { return request.user!; }

/** Resolve author names through the User Service internal lookup; unknown authors show as "Member". */
async function authorNames(request: FastifyRequest, ids: string[]): Promise<Names> {
  const names: Names = new Map();
  await Promise.all([...new Set(ids)].map(async id => {
    try {
      const response = await fetch(`${process.env.USER_SERVICE_URL ?? 'http://user-service:47820'}/api/users/internal/users/${id}`, {
        headers: { 'x-internal-token': getConfig().internalToken, ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}) },
        signal: AbortSignal.timeout(3000)
      });
      const value = response.ok ? await response.json() as { name?: unknown } : null;
      names.set(id, typeof value?.name === 'string' && value.name ? value.name : 'Member');
    } catch { names.set(id, 'Member'); }
  }));
  return names;
}

/** A post in any community the caller is a member of (not only the active one), else 404. */
async function getPost(id: string, request: FastifyRequest): Promise<typeof posts.$inferSelect> {
  const tenantIds = (await memberCommunities(request)).map(item => item.id);
  const row = (await getDb().select({ post: posts }).from(posts).innerJoin(challenges, and(eq(challenges.id, posts.challenge_id), eq(challenges.tenant_id, posts.tenant_id)))
    .where(and(eq(posts.id, id), inArray(posts.tenant_id, tenantIds))).limit(1))[0];
  if (!row) fail(404, 'Post not found');
  return row.post;
}
function encodeCursor(row: { created_at: Date; id: string }): string { return Buffer.from(`${row.created_at.toISOString()}|${row.id}`).toString('base64url'); }
function decodeCursor(value: string): { at: Date; id: string } {
  const [iso, id] = Buffer.from(value, 'base64url').toString().split('|');
  const at = new Date(iso ?? '');
  if (!id || Number.isNaN(at.getTime())) fail(400, 'Invalid cursor');
  return { at, id };
}
async function likeState(postId: string, userId: string): Promise<{ like_count: number; liked_by_me: boolean }> {
  const rows = await getDb().select({ user_id: postLikes.user_id }).from(postLikes).where(eq(postLikes.post_id, postId));
  return { like_count: rows.length, liked_by_me: rows.some(row => row.user_id === userId) };
}
function commentView(row: CommentRow, names: Names) {
  return { id: row.id, post_id: row.post_id, author_id: row.author_id, author_name: names.get(row.author_id) ?? 'Member', body: row.body, created_at: row.created_at };
}

export async function registerWallRoutes(app: FastifyInstance): Promise<void> {
  app.get('/wall', { onRequest: requireUser, schema: { querystring: Type.Object({ cursor: Type.Optional(Type.String({ maxLength: 200 })), community_id: Type.Optional(Uuid) }) } }, async request => {
    const identity = idn(request); const { cursor, community_id } = request.query as { cursor?: string; community_id?: string };
    // Home: posts of every community I belong to. With community_id: that community (non-members see its public challenges only).
    const mine = await memberCommunities(request); const communityNames = new Map(mine.map(item => [item.id, item.name]));
    const isMember = community_id === undefined || communityNames.has(community_id);
    const tenantIds = community_id !== undefined ? [community_id] : mine.map(item => item.id);
    const where = [inArray(posts.tenant_id, tenantIds)];
    if (!isMember) where.push(eq(challenges.visibility, 'public'));
    if (cursor) { const c = decodeCursor(cursor); where.push(or(lt(posts.created_at, c.at), and(eq(posts.created_at, c.at), lt(posts.id, c.id)))!); }
    const db = getDb();
    const rows = await db.select({ post: posts, challenge: challenges }).from(posts)
      .innerJoin(challenges, and(eq(challenges.id, posts.challenge_id), eq(challenges.tenant_id, posts.tenant_id)))
      .where(and(...where)).orderBy(desc(posts.created_at), desc(posts.id)).limit(PAGE_SIZE + 1);
    const page = rows.slice(0, PAGE_SIZE);
    const postIds = page.map(row => row.post.id); const challengeIds = page.map(row => row.challenge.id);
    let likes: { post_id: string; user_id: string }[] = []; let counts: { post_id: string; total: number }[] = [];
    let latest: CommentRow[][] = []; let joined: { challenge_id: string; user_id: string }[] = [];
    if (postIds.length) {
      [likes, counts, latest, joined] = await Promise.all([
        db.select({ post_id: postLikes.post_id, user_id: postLikes.user_id }).from(postLikes).where(and(inArray(postLikes.tenant_id, tenantIds), inArray(postLikes.post_id, postIds))),
        db.select({ post_id: postComments.post_id, total: count() }).from(postComments).where(and(inArray(postComments.tenant_id, tenantIds), inArray(postComments.post_id, postIds))).groupBy(postComments.post_id),
        Promise.all(postIds.map(id => db.select().from(postComments).where(and(inArray(postComments.tenant_id, tenantIds), eq(postComments.post_id, id))).orderBy(desc(postComments.created_at), desc(postComments.id)).limit(2))),
        db.select({ challenge_id: participants.challenge_id, user_id: participants.user_id }).from(participants).where(and(inArray(participants.tenant_id, tenantIds), eq(participants.status, 'joined'), inArray(participants.challenge_id, challengeIds)))
      ]);
    }
    const names = await authorNames(request, [...page.map(row => row.post.author_id), ...latest.flat().map(row => row.author_id)]);
    const items = page.map(({ post, challenge }, index) => {
      const mine = likes.filter(like => like.post_id === post.id);
      const members = joined.filter(row => row.challenge_id === post.challenge_id);
      return {
        id: post.id, challenge_id: post.challenge_id, author_id: post.author_id, author_name: names.get(post.author_id) ?? 'Member', caption: post.caption,
        image_url: post.image_url, caring_value: post.caring_value, created_at: post.created_at,
        community: { id: post.tenant_id, name: communityNames.get(post.tenant_id) ?? '' }, is_member: communityNames.has(post.tenant_id),
        challenge: { id: challenge.id, owner_id: challenge.owner_id, visibility: challenge.visibility, title: challenge.title, activity_category: challenge.activity_category, start_date: challenge.start_date, end_date: challenge.end_date, target_count: challenge.target_count },
        like_count: mine.length, liked_by_me: mine.some(like => like.user_id === identity.userId),
        comment_count: Number(counts.find(row => row.post_id === post.id)?.total ?? 0),
        latest_comments: (latest[index] ?? []).map(row => commentView(row, names)),
        owned_by_me: challenge.owner_id === identity.userId, participant_count: members.length, joined_by_me: members.some(row => row.user_id === identity.userId)
      };
    });
    return { posts: items, next_cursor: rows.length > PAGE_SIZE ? encodeCursor(page[page.length - 1]!.post) : null };
  });
  app.post('/wall/:post_id/like', { onRequest: requireUser, schema: { params: Type.Object({ post_id: Uuid }) } }, async request => {
    const identity = idn(request); const post = await getPost((request.params as { post_id: string }).post_id, request);
    const removed = await getDb().delete(postLikes).where(and(eq(postLikes.post_id, post.id), eq(postLikes.user_id, identity.userId))).returning();
    if (removed.length === 0) await getDb().insert(postLikes).values({ post_id: post.id, user_id: identity.userId, tenant_id: post.tenant_id }).onConflictDoNothing();
    return likeState(post.id, identity.userId);
  });
  app.get('/wall/:post_id/comments', { onRequest: requireUser, schema: { params: Type.Object({ post_id: Uuid }) } }, async request => {
    const post = await getPost((request.params as { post_id: string }).post_id, request);
    const rows = await getDb().select().from(postComments).where(and(eq(postComments.tenant_id, post.tenant_id), eq(postComments.post_id, post.id))).orderBy(postComments.created_at, postComments.id);
    const names = await authorNames(request, rows.map(row => row.author_id));
    return rows.map(row => commentView(row, names));
  });
  app.post('/wall/:post_id/comments', { onRequest: requireUser, schema: { params: Type.Object({ post_id: Uuid }), body: CommentBody } }, async (request, reply) => {
    const identity = idn(request); const post = await getPost((request.params as { post_id: string }).post_id, request);
    const body = (request.body as Static<typeof CommentBody>).body.trim();
    if (!body) fail(400, 'Comment cannot be empty');
    const created = (await getDb().insert(postComments).values({ id: randomUUID(), post_id: post.id, tenant_id: post.tenant_id, author_id: identity.userId, body }).returning())[0]!;
    return reply.code(201).send(commentView(created, await authorNames(request, [identity.userId])));
  });
  app.delete('/wall/comments/:id', { onRequest: requireUser, schema: { params: Type.Object({ id: Uuid }) } }, async (request, reply) => {
    const identity = idn(request); const id = (request.params as { id: string }).id;
    const tenantIds = (await memberCommunities(request)).map(item => item.id);
    const row = (await getDb().select().from(postComments).where(and(eq(postComments.id, id), inArray(postComments.tenant_id, tenantIds))).limit(1))[0];
    if (!row) fail(404, 'Comment not found');
    if (row.author_id !== identity.userId) fail(403, 'Only the author can delete a comment');
    await getDb().delete(postComments).where(and(eq(postComments.id, id), eq(postComments.tenant_id, row.tenant_id)));
    return reply.code(204).send();
  });
}
