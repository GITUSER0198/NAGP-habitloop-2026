<script lang="ts">
  import { enhance, deserialize, applyAction } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { invalidateAll } from '$app/navigation';
  import type { PageProps } from './$types';
  import { rememberOpen } from '$lib/disclosure';
  import { app } from '$lib/config/app';
  import type { Recommendation } from '../community';
  import { useCommunity } from '../community.svelte';
  import RecommendationCard from './RecommendationCard.svelte';
  import Busy from '$lib/components/Busy.svelte';
  let { data, form }: PageProps = $props();
  const community = useCommunity();
  let busy = $state(false);
  let step = $state('');
  let removed = $state<Recommendation | null>(null);
  const unavailableRow = $derived(removed ?? data.history.find(row => row.id === (form && 'removed' in form ? form.removed : '')));
  const pending = $derived(data.pending.filter(row => row.id !== (form && 'removed' in form ? form.removed : '') && row.id !== removed?.id));
  $effect(() => { community.recommendations = pending.length; });
  const submit: SubmitFunction = ({ cancel }) => {
    if (busy) { cancel(); return; }
    busy = true;
    step = 'Updating suggestion';
    return async ({ result, update }) => {
      try {
        if (result.type === 'failure' && result.status === 409 && result.data && 'removed' in result.data) {
          removed = data.pending.find(row => row.id === result.data?.removed) ?? null;
        }
        await update();
        if (result.type === 'failure') await invalidateAll();
        step = '';
      } finally { busy = false; }
    };
  };
  const refresh: SubmitFunction = async ({ cancel }) => {
    if (busy) { cancel(); return; }
    busy = true;
    removed = null;
    step = 'Reading your history';
    try {
      const response = await fetch('?/history', { method: 'POST', headers: { 'x-sveltekit-action': 'true' }, body: new FormData() });
      const result = deserialize(await response.text());
      if (result.type !== 'success') {
        cancel(); await applyAction(result); step = 'Refresh failed. Please try again.'; busy = false; return;
      }
      step = 'Scoring time windows';
    } catch {
      cancel(); step = 'Refresh failed. Check your connection and try again.'; busy = false; return;
    }
    return async ({ result, update }) => {
      try {
        await update();
        step = result.type === 'success' ? `Done, ${data.pending.length} suggestions` : 'Refresh failed. Please try again.';
      } finally { busy = false; }
    };
  };
</script>
<svelte:head><title>Recommendations | {app.name}</title></svelte:head>
<div class="page-heading"><h1>Recommendations</h1>
  <form method="POST" action="?/refresh" use:enhance={refresh}><button disabled={busy}>Refresh suggestions</button></form>
</div>
{#if busy}<Busy label={step} />{:else if step}<p role="status">{step}</p>{/if}
{#if form?.message && form.message !== step}<p class="notice" role="status">{form.message}</p>{/if}
{#if form && 'accepted' in form && form.accepted}
  <RecommendationCard row={form.accepted} name={data.activities.find(activity => activity.id === form.accepted.activity_id)?.name ?? 'Activity'} idPrefix="accepted-recommendation" {submit} />
{/if}
{#if unavailableRow}<RecommendationCard row={unavailableRow} name="No longer applies" unavailable idPrefix="unavailable-recommendation" {submit} />{/if}
<section class="stack" aria-label="Pending suggestions"><h2>Pending suggestions ({pending.length})</h2>
  {#each pending as row (row.id)}
    <RecommendationCard {row} name={data.activities.find(activity => activity.id === row.activity_id)?.name ?? 'Activity removed'} {busy} {submit} />
  {:else}<p class="muted">{data.reason ?? 'No pending suggestions. Refresh after logging more activities.'}</p>{/each}
</section>
<details class="card" use:rememberOpen={'recommendation-history'}><summary>History ({data.history.length})</summary>
  <div class="stack">
    {#each data.history as row (row.id)}
      <RecommendationCard {row} name={data.activities.find(activity => activity.id === row.activity_id)?.name ?? 'Activity removed'} {submit} />
    {:else}<p>No accepted or dismissed suggestions yet.</p>{/each}
  </div>
</details>
