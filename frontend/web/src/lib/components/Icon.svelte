<script lang="ts">
  import { icons, type IconName } from '$lib/icons';
  let { name, size = 20 }: { name: IconName; size?: number } = $props();
</script>
<svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  {#each icons[name] as path}<path d={path} />{/each}
</svg>
