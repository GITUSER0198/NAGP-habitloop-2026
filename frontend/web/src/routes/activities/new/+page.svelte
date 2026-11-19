<script lang="ts">
  import type { PageProps } from './$types';
  import ActivityForm from '$lib/components/ActivityForm.svelte';
  import { app } from '$lib/config/app';
  let { data, form }: PageProps = $props();
</script>
<svelte:head><title>New activity | {app.name}</title></svelte:head>
<section class="card form-page"><h1>New activity</h1>
  <ActivityForm categories={data.categories} values={form?.values} errors={form?.errors} />
</section>
