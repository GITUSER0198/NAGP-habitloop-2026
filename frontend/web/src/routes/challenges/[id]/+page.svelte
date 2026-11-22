<script lang="ts">
  import type { PageProps } from './$types';
  import { features } from '$lib/config/features';
  import { app } from '$lib/config/app';
  let { data }: PageProps = $props();
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
    <p>{data.challenge.description}</p><p>{data.challenge.visibility === 'members' ? 'Members only' : 'Public'} challenge</p>
    {#if features.categories}<p>Category: {data.challenge.activity_category}</p>{/if}
    <p>{data.challenge.start_date} to {data.challenge.end_date}</p><p>Target: {data.challenge.target_count} activities</p>
    {#if data.challenge.owner_id === data.user?.id}<p class="pill tonal">Your challenge</p>{/if}
  </section>
  {#if features.leaderboard}
    {#if data.progressError}<p class="error" role="alert">Leaderboard: {data.progressError}</p>
    {:else}<hl-leaderboard rows={JSON.stringify(rows)}></hl-leaderboard>{/if}
  {/if}
</div>
