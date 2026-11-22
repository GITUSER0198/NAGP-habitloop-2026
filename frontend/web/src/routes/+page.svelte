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
  const groups = $derived(data.communities.filter(item => item.kind === 'community'));
  let loading = $state(false);
  let failed = $state('');
  let now = $state(Date.now());
  onMount(() => { const timer = setInterval(() => { now = Date.now(); }, 60000); return () => clearInterval(timer); });
  $effect(() => { posts = data.wall.posts; cursor = data.wall.next_cursor; });

  async function more(): Promise<void> {
    if (!cursor || loading) return;
    loading = true; failed = '';
    try {
      const response = await fetch(`/api/wall?cursor=${encodeURIComponent(cursor)}${data.filter ? `&community_id=${data.filter}` : ''}`);
      if (!response.ok) throw new Error('Could not load more posts.');
      const next = await response.json() as WallPage;
      posts = [...posts, ...next.posts]; cursor = next.next_cursor;
    } catch (cause) { failed = cause instanceof Error ? cause.message : 'Could not load more posts.'; }
    finally { loading = false; }
  }
</script>
<svelte:head><title>Home | {app.name}</title></svelte:head>
<div class="wall-layout">
  <section class="stack wall-feed" aria-label="All my communities">
    <div class="page-heading"><h1>All my communities</h1><a class="button outlined" href="/challenges/new"><Icon name="plus" size={18} />New challenge</a></div>
    <div class="chips filter-chips" role="group" aria-label="Filter by community">
      <a class="chip" href="/" aria-current={data.filter ? undefined : 'true'}>All</a>
      {#each groups as item (item.id)}<a class="chip" href={`/?community=${item.id}`} aria-current={data.filter === item.id ? 'true' : undefined}>{item.name}</a>{/each}
    </div>
    {#each posts as post (post.id)}<PostCard {post} {now} />
    {:else}
      <div class="card"><h2>Nothing posted yet</h2><p class="muted">Challenges created in your communities show up here. Start the first one.</p>
        <a class="button" href="/challenges/new">Create a challenge</a></div>
    {/each}
    {#if cursor}
      <button type="button" class="outlined" disabled={loading} onclick={more}>{loading ? 'Loading...' : 'Show more posts'}</button>
    {/if}
    {#if failed}<p class="error" role="alert">{failed}</p>{/if}
  </section>
  <aside class="stack wall-rail" aria-label="Community and progress">
    <section class="card">
      <h2>Your communities</h2>
      <ul class="plain-list">
        {#each groups as item (item.id)}<li><a href={`/communities/${item.id}`}>{item.name}</a> <small class="muted">{item.member_count} {item.member_count === 1 ? 'member' : 'members'}</small></li>
        {:else}<li class="muted">You have not joined a community yet.</li>{/each}
      </ul>
      <a href="/communities">Browse communities</a>
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
