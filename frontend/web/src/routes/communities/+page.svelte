<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { PageProps } from './$types';
  import { app } from '$lib/config/app';
  import Busy from '$lib/components/Busy.svelte';
  import Icon from '$lib/components/Icon.svelte';

  let { data, form }: PageProps = $props();
  let busy = $state('');
  const submit = (label: string): SubmitFunction => ({ cancel }) => {
    if (busy) { cancel(); return; }
    busy = label;
    return async ({ update }) => { try { await update({ reset: false }); } finally { busy = ''; } };
  };
  const members = (count: number): string => `${count} ${count === 1 ? 'member' : 'members'}`;
  const ordered = $derived([...data.mine.filter(item => item.kind === 'personal'), ...data.mine.filter(item => item.kind !== 'personal')]);
  const left = $derived(!!form?.message && form.message.startsWith('You left'));
</script>

<svelte:head><title>Communities | {app.name}</title></svelte:head>
<section class="hero compact" aria-label="Communities overview">
  <div class="hero-main">
    <p class="eyebrow">{data.welcome ? 'Welcome' : 'Together'}</p>
    <h1>Communities</h1>
    <p>{data.welcome ? 'Create a community or join one to share challenges. You can also start right away in your Personal space.'
      : 'Each community has its own activities, challenges and leaderboard. Switch any time from the top bar.'}</p>
  </div>
  {#if data.welcome}<a class="button" href="/dashboard">Start in my Personal space</a>{/if}
</section>
{#if form?.message}<p role={left ? 'status' : 'alert'} class={left ? 'notice' : 'error'}>{form.message}</p>{/if}
{#if busy}<Busy label={busy} />{/if}

<div class="stack">
  <section aria-labelledby="mine-heading">
    <div class="section-head"><h2 id="mine-heading">Your communities</h2></div>
    <div class="community-grid">
      {#each ordered as item (item.id)}
        <article class="card community-card" class:is-active={item.active}>
          <div class="card-head">
            <span class="icon-tile"><Icon name="users" /></span>
            <h3>{item.name}</h3>
            {#if item.active}<span class="pill tonal">Active</span>{/if}
          </div>
          {#if item.description}<p class="muted">{item.description}</p>{/if}
          <p class="chips">
            <span class="pill">{item.kind === 'personal' ? 'Private to you' : members(item.member_count)}</span>
            {#if item.kind === 'organization'}<span class="pill tonal">Organization</span>{/if}
            <span class="pill">{item.role === 'owner' ? 'Owner' : 'Member'}</span>
          </p>
          <div class="actions">
            {#if !item.active}
              <form method="POST" action="?/switch" use:enhance={submit('Switching community')}>
                <input type="hidden" name="community_id" value={item.id} /><input type="hidden" name="redirect_to" value="/dashboard" />
                <button class="secondary" disabled={!!busy}>Switch</button>
              </form>
            {:else}
              <a class="button secondary" href="/dashboard">Open dashboard</a>
            {/if}
            {#if item.kind === 'community'}
              <form method="POST" action="?/leave" use:enhance={submit('Leaving community')}>
                <input type="hidden" name="community_id" value={item.id} /><input type="hidden" name="community_name" value={item.name} />
                <button class="outlined" disabled={!!busy}>Leave</button>
              </form>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  </section>

  <section aria-labelledby="discover-heading">
    <div class="section-head"><h2 id="discover-heading">Discover</h2></div>
    <form method="GET" class="search-row" role="search">
      <label class="sr-only" for="q">Search communities</label>
      <input id="q" name="q" type="search" maxlength="100" placeholder="Search communities" value={data.q} />
      <button class="secondary">Search</button>
    </form>
    <div class="community-grid">
      {#each data.discover as item (item.id)}
        <article class="card community-card">
          <div class="card-head"><span class="icon-tile"><Icon name="users" /></span><h3>{item.name}</h3></div>
          {#if item.description}<p class="muted">{item.description}</p>{/if}
          <p class="chips"><span class="pill">{members(item.member_count)}</span></p>
          {#if data.publicChallenges[item.id]?.length}
            <h4>Public challenges</h4>
            <ul class="plain-list">
              {#each data.publicChallenges[item.id] as challenge (challenge.id)}
                <li><strong>{challenge.title}</strong> <small class="muted">Join community to take part</small></li>
              {/each}
            </ul>
          {/if}
          <form method="POST" action="?/join" use:enhance={submit('Joining community')}>
            <input type="hidden" name="community_id" value={item.id} />
            <button disabled={!!busy}>Join</button>
          </form>
        </article>
      {:else}
        <p class="muted">{data.q ? 'No communities match your search.' : 'No other public communities yet. Create the first one below.'}</p>
      {/each}
    </div>
  </section>

  <section id="create" class="card" aria-labelledby="create-heading">
    <h2 id="create-heading">Create a community</h2>
    <form method="POST" action="?/create" use:enhance={submit('Creating community')}>
      <label for="community-name">Name</label>
      <input id="community-name" name="name" required minlength="3" maxlength="60" value={form?.name ?? ''} />
      <label for="community-description">Description (optional)</label>
      <input id="community-description" name="description" maxlength="500" value={form?.description ?? ''} />
      <p class="muted">Anyone can find and join a community. You become its owner.</p>
      <button disabled={!!busy}>Create community</button>
    </form>
  </section>
</div>
