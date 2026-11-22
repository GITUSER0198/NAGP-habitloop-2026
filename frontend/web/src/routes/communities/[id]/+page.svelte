<script lang="ts">
  import { enhance } from '$app/forms';
  import { onMount, untrack } from 'svelte';
  import type { PageProps } from './$types';
  import { app } from '$lib/config/app';
  import PostCard from '$lib/components/PostCard.svelte';
  import Busy from '$lib/components/Busy.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import type { WallPage } from '$lib/wall';

  let { data, form }: PageProps = $props();
  let posts = $state(untrack(() => data.wall.posts));
  let cursor = $state<string | null>(untrack(() => data.wall.next_cursor));
  let loading = $state(false);
  let busy = $state('');
  let failed = $state('');
  let now = $state(Date.now());
  onMount(() => { const timer = setInterval(() => { now = Date.now(); }, 60000); return () => clearInterval(timer); });
  $effect(() => { posts = data.wall.posts; cursor = data.wall.next_cursor; });
  const members = $derived(`${data.community.member_count} ${data.community.member_count === 1 ? 'member' : 'members'}`);

  async function more(): Promise<void> {
    if (!cursor || loading) return;
    loading = true; failed = '';
    try {
      const response = await fetch(`/api/wall?cursor=${encodeURIComponent(cursor)}&community_id=${data.community.id}`);
      if (!response.ok) throw new Error('Could not load more posts.');
      const next = await response.json() as WallPage;
      posts = [...posts, ...next.posts]; cursor = next.next_cursor;
    } catch (cause) { failed = cause instanceof Error ? cause.message : 'Could not load more posts.'; }
    finally { loading = false; }
  }
  const submit = (label: string) => () => {
    busy = label;
    return async ({ update }: { update: () => Promise<void> }) => { try { await update(); } finally { busy = ''; } };
  };
</script>
<svelte:head><title>{data.community.name} | {app.name}</title></svelte:head>
<a href="/communities">Back to communities</a>
<section class="hero compact" aria-label="Community header">
  <div class="hero-main">
    <p class="eyebrow">Community</p>
    <h1>{data.community.name}</h1>
    {#if data.community.description}<p>{data.community.description}</p>{/if}
    <p class="chips"><span class="pill">{members}</span>{#if data.member}<span class="pill">Your role: {data.role === 'owner' ? 'Owner' : 'Member'}</span>{/if}</p>
  </div>
  <div class="actions">
    {#if data.member}
      <a class="button" href={`/communities/${data.community.id}/challenges/new`}><Icon name="plus" size={18} />Post a challenge</a>
      {#if data.kind === 'community'}
        <form method="POST" action="?/leave" use:enhance={submit('Leaving community')}><button class="outlined" disabled={!!busy}>Leave</button></form>
      {/if}
    {:else}
      <form method="POST" action="?/join" use:enhance={submit('Joining community')}><button disabled={!!busy}>Join community</button></form>
    {/if}
  </div>
</section>
{#if form?.message}<p role="alert" class="error">{form.message}</p>{/if}
{#if busy}<Busy label={busy} />{/if}
<section class="stack wall-feed community-feed" aria-label="Challenges in this community">
  <h2>Challenges</h2>
  {#if !data.member}<p class="muted">Public challenges are shown. Join the community to take part and see members-only ones.</p>{/if}
  {#each posts as post (post.id)}<PostCard {post} {now} />
  {:else}<div class="card"><p class="muted">No challenges here yet.{#if data.member} <a href={`/communities/${data.community.id}/challenges/new`}>Post the first one.</a>{/if}</p></div>{/each}
  {#if cursor}<button type="button" class="outlined" disabled={loading} onclick={more}>{loading ? 'Loading...' : 'Show more posts'}</button>{/if}
  {#if failed}<p class="error" role="alert">{failed}</p>{/if}
</section>
