<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { PageProps } from './$types';
  import { app } from '$lib/config/app';
    import PostCard from '$lib/components/PostCard.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import type { WallPage } from '$lib/wall';

  let { data }: PageProps = $props();
  let posts = $state(untrack(() => data.wall.posts));
  let cursor = $state<string | null>(untrack(() => data.wall.next_cursor));
  let loading = $state(false);
  let failed = $state('');
  let now = $state(Date.now());
  onMount(() => { const timer = setInterval(() => { now = Date.now(); }, 60000); return () => clearInterval(timer); });
  $effect(() => { posts = data.wall.posts; cursor = data.wall.next_cursor; });

  async function more(): Promise<void> {
    if (!cursor || loading) return;
    loading = true; failed = '';
    try {
      const response = await fetch(`/api/wall?cursor=${encodeURIComponent(cursor)}`);
      if (!response.ok) throw new Error('Could not load more posts.');
      const next = await response.json() as WallPage;
      posts = [...posts, ...next.posts]; cursor = next.next_cursor;
    } catch (cause) { failed = cause instanceof Error ? cause.message : 'Could not load more posts.'; }
    finally { loading = false; }
  }
</script>
<svelte:head><title>Home | {app.name}</title></svelte:head>
<div class="wall-layout">
  <section class="stack wall-feed" aria-label="Community wall">
    <div class="page-heading"><h1>Home</h1><a class="button outlined" href="/challenges/new"><Icon name="plus" size={18} />New challenge</a></div>
    {#each posts as post (post.id)}<PostCard {post} {now} />
    {:else}
      <div class="card"><h2>Nothing posted yet</h2><p class="muted">Challenges you and your community create show up here. Start the first one.</p>
        <a class="button" href="/challenges/new">Create a challenge</a></div>
    {/each}
    {#if cursor}
      <button type="button" class="outlined" disabled={loading} onclick={more}>{loading ? 'Loading...' : 'Show more posts'}</button>
    {/if}
    {#if failed}<p class="error" role="alert">{failed}</p>{/if}
  </section>
  <aside class="stack wall-rail" aria-label="Community and progress">
    <section class="card">
      <h2>{data.community?.name ?? 'Your community'}</h2>
      {#if data.community}<p class="muted">{data.community.member_count} {data.community.member_count === 1 ? 'member' : 'members'}</p>
        {#if data.community.description}<p>{data.community.description}</p>{/if}{/if}
    </section>
    <section class="card"><h2>Your progress</h2>
      {#if data.summary}
        <dl class="mini-stats">
          <div><dt>Done today</dt><dd>{data.summary.today.done}</dd></div>
          <div><dt>Current streak</dt><dd>{data.summary.current_streak} days</dd></div>
          <div><dt>7-day rate</dt><dd>{Math.round(data.summary.rate_7d * 100)}%</dd></div>
        </dl>
      {:else}<p class="muted">Progress is unavailable right now.</p>{/if}
      <a href="/dashboard">Open dashboard</a>
    </section>
  </aside>
</div>
