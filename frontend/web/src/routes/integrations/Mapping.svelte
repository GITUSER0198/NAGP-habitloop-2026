<script lang="ts">
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { Activity } from '$lib/types';
  let { id, types, map, activities, busy, submit }: {
    id: string; types: string[]; map: Record<string, string>; activities: Activity[]; busy: boolean; submit: SubmitFunction;
  } = $props();
  let draft = $state<Record<string, string>>(untrack(() => Object.fromEntries(types.map(type => [type, map[type] ?? '']))));
</script>
<form method="POST" action="?/mapping" use:enhance={submit}>
  <input type="hidden" name="id" value={id} />
  {#each types as type}
    <div class="mapping-row">
      <label for={`${id}-${type}`}>{type}</label>
      <select id={`${id}-${type}`} name={`map:${type}`} bind:value={draft[type]}>
        <option value="">Skip this type</option>
        {#if draft[type] && !activities.some(activity => activity.id === draft[type])}<option value={draft[type]} disabled>Activity removed: choose another</option>{/if}
        {#each activities as activity}<option value={activity.id}>{activity.name}</option>{/each}
      </select>
    </div>
  {/each}
  <button disabled={busy}>Save mapping</button>
</form>
<style>
  .mapping-row { display: grid; grid-template-columns: minmax(4rem, 1fr) minmax(0, 3fr); align-items: center; gap: 1rem; margin-bottom: .75rem; }
  label { text-transform: capitalize; }
  select { margin: 0; width: 100%; }
</style>
