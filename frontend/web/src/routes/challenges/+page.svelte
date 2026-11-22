<script lang="ts">
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { PageProps } from './$types';
  import { app } from '$lib/config/app';
  import Busy from '$lib/components/Busy.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ActionForms from '../ActionForms.svelte';
  import { submitAction } from '../community';
  let { data, form }: PageProps = $props();
  let busy = $state(false);
  const submit: SubmitFunction = ({ cancel }) => {
    if (busy) { cancel(); return; }
    busy = true;
    return async ({ update }) => { try { await update(); } finally { busy = false; } };
  };
</script>
<svelte:head><title>Challenges | {app.name}</title></svelte:head>
<section class="hero compact" aria-label="Challenges overview">
  <div class="hero-main"><p class="eyebrow">{data.community?.name ?? 'Your community'}</p><h1>Challenges</h1>
    <p>Join a challenge and climb the leaderboard together.</p></div>
  <a class="button" href="/challenges/new"><Icon name="plus" size={18} />New challenge</a>
</section>
{#if form?.message}<p role="status" class="notice">{form.message}</p>{/if}
{#if form && 'errors' in form}{#each Object.entries(form.errors ?? {}) as [key, message]}<p class="error">{key}: {message}</p>{/each}{/if}
{#if busy}<Busy label="Updating challenges" />{/if}
<section class="stack" aria-label="Challenge feed">
  <h2>Challenge feed</h2>
  {#each data.challenges as challenge (challenge.id)}
    {@const owner = challenge.owner_id === data.user?.id}
    <div>
      <a href={`/challenges/${challenge.id}`}>View {challenge.title}</a>
      <hl-challenge-card title={challenge.title} visibility={challenge.visibility === 'members' ? 'members only' : challenge.visibility} target={challenge.target_count} {busy}
        participants={data.stats[challenge.id]?.participants ?? 0} progress={data.stats[challenge.id]?.progress ?? 0}
        {owner} joined={data.stats[challenge.id]?.joined || (form && 'joined' in form && form.joined === challenge.id) || false}
        onhlJoin={() => submitAction(`${challenge.id}-join`)}></hl-challenge-card>
      {#if !owner}<ActionForms id={challenge.id} actions={[{ action: 'join', label: 'Join challenge' }]} {submit} />{/if}
    </div>
  {:else}<p class="muted">No challenges in this community yet. <a href="/challenges/new">Create the first one.</a></p>{/each}
</section>
