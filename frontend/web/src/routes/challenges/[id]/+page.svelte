<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageProps } from './$types';
  import { features } from '$lib/config/features';
  import { app } from '$lib/config/app';
  import Busy from '$lib/components/Busy.svelte';
  let { data, form }: PageProps = $props();
  let busy = $state(false);
  const rows = $derived(data.progress?.leaderboard.map(row => ({
    name: row.name,
    count: row.count, target: row.target, isMe: row.user_id === data.user?.id
  })) ?? []);
</script>
<svelte:head><title>{data.challenge.title} | {app.name}</title></svelte:head>
<a href="/challenges">Back to challenges</a>
<h1>{data.challenge.title}</h1>
<div class="dashboard-grid">
  <section class="card">
    <p>{data.challenge.description}</p><p>{data.challenge.visibility} challenge</p>
    {#if features.categories}<p>Category: {data.challenge.activity_category}</p>{/if}
    <p>{data.challenge.start_date} to {data.challenge.end_date}</p><p>Target: {data.challenge.target_count} activities</p>
    {#if data.challenge.owner_id === data.user?.id}
      <h2>Invite a participant</h2>
      <p class="muted">Send one invitation at a time using a participant's email in your tenant. Leave blank to show the code.</p>
      <form method="POST" action="?/invite" use:enhance={() => {
        busy = true; return async ({ update }) => { try { await update({ reset: false }); } finally { busy = false; } };
      }}>
        <label for="recipient">Participant email (optional)</label><input id="recipient" name="email" type="email" />
        <button disabled={busy}>Invite or show code</button>
      </form>
      {#if form && 'errors' in form}<p class="error" role="alert">{form.message}</p>{/if}
      {#if busy}<Busy label="Verifying participant and preparing invitation" />{/if}
    {/if}
    {#if form?.message && !('errors' in form)}<p class="notice" role="status">{form.message}</p>{/if}
    {#if form && 'code' in form}<p>Invite code: <strong>{form.code}</strong></p>{/if}
  </section>
  {#if features.leaderboard}
    {#if data.progressError}<p class="error" role="alert">Leaderboard: {data.progressError}</p>
    {:else}<hl-leaderboard rows={JSON.stringify(rows)}></hl-leaderboard>{/if}
  {/if}
</div>
