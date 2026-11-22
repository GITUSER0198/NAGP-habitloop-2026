<script lang="ts">
  import { goto } from '$app/navigation';
  import type { PageProps } from './$types';
  import { app } from '$lib/config/app';
  let { data }: PageProps = $props();
  let chosen = $state('');
  const selected = $derived(chosen || data.active);
  const label = (item: { name: string; kind: string }): string => item.kind === 'personal' ? `${item.name} (private to you)` : item.name;
</script>
<svelte:head><title>New challenge | {app.name}</title></svelte:head>
<a href="/challenges">Back to challenges</a>
<section class="card stack">
  <h1>New challenge</h1>
  <p class="muted">Pick the community this challenge belongs to. It is posted on that community's page and in everyone's feed.</p>
  <form method="GET" action={`/communities/${selected}/challenges/new`} onsubmit={(event) => { event.preventDefault(); void goto(`/communities/${selected}/challenges/new`); }}>
    <label for="community">Community</label>
    <select id="community" value={selected} onchange={(event) => { chosen = event.currentTarget.value; }}>
      {#each data.choices as item (item.id)}<option value={item.id}>{label(item)}{item.active ? ' (active)' : ''}</option>{/each}
    </select>
    <button type="submit" disabled={!selected}>Continue</button>
  </form>
</section>
