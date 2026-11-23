<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { rememberOpen } from '$lib/disclosure';
  import { relativeTime } from '$lib/time';
  import type { WallComment, WallPost } from '$lib/wall';

  let { post: initial, now }: { post: WallPost; now: number } = $props();
  // The card owns its optimistic state; the page only supplies the first copy of the post.
  let post = $state<WallPost>(untrack(() => ({ ...initial })));
  let likeBusy = $state(false);
  let joinBusy = $state(false);
  let commentBusy = $state(false);
  let draft = $state('');
  let error = $state('');
  let imageFailed = $state(false);
  let all = $state<WallComment[] | null>(null);
  let loadingAll = $state(false);
  let expanded = $state(false);

  const initials = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0].toUpperCase()).join('') || '?';
  const shown = $derived(expanded && all ? all : [...post.latest_comments].reverse());

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(path, { ...init, headers: init.body ? { 'Content-Type': 'application/json' } : undefined });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(typeof payload.message === 'string' ? payload.message : 'Something went wrong. Please try again.');
    }
    return response.json() as Promise<T>;
  }
  async function toggleLike(): Promise<void> {
    if (likeBusy) return;
    likeBusy = true; error = '';
    const before = { liked: post.liked_by_me, count: post.like_count };
    post.liked_by_me = !before.liked;
    post.like_count = before.count + (before.liked ? -1 : 1);
    try {
      const result = await call<{ like_count: number; liked_by_me: boolean }>(`/api/wall/${post.id}/like`, { method: 'POST' });
      post.like_count = result.like_count; post.liked_by_me = result.liked_by_me;
    } catch (cause) {
      post.liked_by_me = before.liked; post.like_count = before.count;
      error = cause instanceof Error ? cause.message : 'Could not update your like.';
    } finally { likeBusy = false; }
  }
  async function join(): Promise<void> {
    if (joinBusy || post.joined_by_me) return;
    joinBusy = true; error = '';
    try {
      await call(`/api/wall/${post.challenge_id}/join`, { method: 'POST' });
      post.joined_by_me = true; post.participant_count += 1;
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not join this challenge.'; }
    finally { joinBusy = false; }
  }
  async function send(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const body = draft.trim();
    if (!body || commentBusy) return;
    commentBusy = true; error = '';
    try {
      const created = await call<WallComment>(`/api/wall/${post.id}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
      post.comment_count += 1;
      post.latest_comments = [created, ...post.latest_comments].slice(0, 2);
      if (all) all = [...all, created];
      draft = '';
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not post your comment.'; }
    finally { commentBusy = false; }
  }
  async function loadAll(event: Event): Promise<void> {
    expanded = (event.currentTarget as HTMLDetailsElement).open;
    if (!expanded || all || loadingAll) return;
    loadingAll = true;
    try { all = await call<WallComment[]>(`/api/wall/${post.id}/comments`); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not load comments.'; }
    finally { loadingAll = false; }
  }
</script>
<article class="card post">
  <header class="post-head">
    <span class="avatar post-avatar" aria-hidden="true">{initials(post.author_name)}</span>
    <div class="post-who"><strong>{post.author_name}</strong>
      <small class="muted">{#if post.community.name}in <a href={`/communities/${post.community.id}`}>{post.community.name}</a> &middot; {/if}{relativeTime(post.created_at, now)}</small></div>
  </header>
  {#if post.image_url && !imageFailed}
    <img class="post-photo" src={post.image_url} alt={`${post.challenge.title} challenge`} loading="lazy" decoding="async" width="1600" height="900" onerror={() => { imageFailed = true; }} />
  {:else}<div class="post-photo post-photo-empty" aria-hidden="true"><Icon name="trophy" size={40} /></div>{/if}
  <h2 class="post-title"><a href={`/challenges/${post.challenge_id}`}>{post.challenge.title}</a></h2>
  {#if post.caption}<p class="post-caption">{post.caption}</p>{/if}
  <p class="post-stats muted">
    <span>{post.like_count} {post.like_count === 1 ? 'like' : 'likes'}</span>
    <span>{post.comment_count} {post.comment_count === 1 ? 'comment' : 'comments'}</span>
    <span>{post.participant_count} {post.participant_count === 1 ? 'participant' : 'participants'}</span>
  </p>
  {#if !post.is_member}
    <p class="post-actions"><a class="button outlined" href={`/communities/${post.community.id}`}>Join community to take part</a></p>
  {:else}
  <div class="post-actions">
    <button type="button" class="outlined post-like" class:liked={post.liked_by_me} aria-pressed={post.liked_by_me} disabled={likeBusy} onclick={toggleLike}>
      <Icon name="heart" size={18} />{post.liked_by_me ? 'Liked' : 'Like'}
    </button>
    <label class="post-comment-link outlined button" for={`comment-${post.id}`}><Icon name="message" size={18} />Comment</label>
    {#if post.owned_by_me}<span class="pill tonal"><Icon name="trophy" size={16} />Your challenge</span>
    {:else if post.joined_by_me}<span class="pill tonal"><Icon name="check" size={16} />Joined</span>
    {:else}<button type="button" disabled={joinBusy} onclick={join}>{joinBusy ? 'Joining...' : 'Join challenge'}</button>{/if}
  </div>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <div class="post-comments">
    {#if post.comment_count > 2}
      <details use:rememberOpen={`wall-comments-${post.id}`} ontoggle={loadAll}>
        <summary>View all {post.comment_count} comments</summary>
        {#if loadingAll}<p class="muted" role="status">Loading comments...</p>{/if}
      </details>
    {/if}
    {#each shown as comment (comment.id)}
      <p class="comment"><span class="avatar mini" aria-hidden="true">{initials(comment.author_name)}</span>
        <span class="comment-text"><strong>{comment.author_name}</strong> {comment.body} <small class="muted">{relativeTime(comment.created_at, now)}</small></span></p>
    {/each}
  </div>
  {#if post.is_member}<form class="comment-box" onsubmit={send}>
    <label class="sr-only" for={`comment-${post.id}`}>Write a comment on {post.challenge.title}</label>
    <input id={`comment-${post.id}`} bind:value={draft} placeholder="Write a comment..." maxlength="1000" autocomplete="off" disabled={commentBusy} />
    <button disabled={commentBusy || !draft.trim()}>{commentBusy ? 'Posting...' : 'Post'}</button>
  </form>{/if}
</article>
