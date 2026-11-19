<script lang="ts">
  import { onMount } from 'svelte';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  let { id, actions, submit }: {
    id: string; actions: { action: string; label: string }[]; submit: SubmitFunction;
  } = $props();
  let ready = $state(false);
  onMount(() => { ready = true; });
</script>
<div class="actions" hidden={ready}>
  {#each actions as item}
    <form id={`${id}-${item.action}`} method="POST" action={`?/${item.action}`} use:enhance={submit}>
      <input type="hidden" name="id" value={id} />
      <button>{item.label}</button>
    </form>
  {/each}
</div>
<style>.actions[hidden] { display: none; }</style>
