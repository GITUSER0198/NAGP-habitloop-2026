<script lang="ts">
  import { onMount } from 'svelte';
  let { label = 'Submitting to the server' }: { label?: string } = $props();
  let seconds = $state(0);
  onMount(() => { const timer = setInterval(() => seconds++, 1000); return () => clearInterval(timer); });
</script>
<p role="status" class="muted">{label}. {seconds}s elapsed.</p>
