<script lang="ts">
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { Recommendation } from '../community';
  import { cardValue, schedule, submitAction } from '../community';
  import ActionForms from '../ActionForms.svelte';
  let { row, name, busy = false, submit, unavailable = false, idPrefix = 'recommendation' }: {
    row: Recommendation; name: string; busy?: boolean; submit: SubmitFunction; unavailable?: boolean; idPrefix?: string;
  } = $props();
</script>
<article>
  <h3>{name}</h3>
  <hl-recommendation-card id={`${idPrefix}-${row.id}`} kind={row.kind} current={cardValue(row, false)} suggested={cardValue(row, true)}
    reason={row.reason} confidence={{ low: 0.3, medium: 0.6, high: 0.9 }[row.confidence]}
    status={unavailable ? 'No longer applies' : row.status} {busy}
    onhlAccept={() => submitAction(`${row.id}-accept`)} onhlDismiss={() => submitAction(`${row.id}-dismiss`)}></hl-recommendation-card>
  {#if row.status === 'pending' && !unavailable}
    <ActionForms id={row.id} actions={[{ action: 'accept', label: 'Accept suggestion' }, { action: 'dismiss', label: 'Dismiss' }]} {submit} />
  {:else if row.status === 'accepted'}<p class="notice">New schedule: {schedule(row.suggested_value)}</p>{/if}
</article>
