<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageProps } from './$types';
  import { features } from '$lib/config/features';
  import { app } from '$lib/config/app';
  import Busy from '$lib/components/Busy.svelte';
  let { data, form }: PageProps = $props();
  let busy = $state(false);
  let visibility = $state('public');
</script>
<svelte:head><title>New challenge | {app.name}</title></svelte:head>
<a href={`/communities/${data.target.id}`}>Back to {data.target.name}</a>
<section class="card stack">
  <h1>New challenge</h1>
  <p class="muted">This challenge belongs to <strong>{data.target.name}</strong> and is posted on its wall.</p>
  {#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}
  <form method="POST" action="?/create" use:enhance={() => {
    busy = true; return async ({ update }) => { try { await update({ reset: false }); } finally { busy = false; } };
  }}>
    <label for="title">Title</label><input id="title" name="title" required maxlength="200" />
    <label for="description">Description</label><textarea id="description" name="description" rows="3" maxlength="10000"></textarea>
    {#if features.categories}
      <label for="category">Category</label><select id="category" name="activity_category" required>
        {#each Object.keys(data.categories) as category}<option value={category}>{category}</option>{/each}
      </select>
    {:else}<input type="hidden" name="activity_category" value="other" />{/if}
    <label for="start">Start date</label><input id="start" name="start_date" type="date" required />
    <label for="end">End date</label><input id="end" name="end_date" type="date" required />
    <label for="target">Target count</label><input id="target" name="target_count" type="number" min="1" step="1" value="7" required />
    <div class="segmented" role="group" aria-label="Visibility">
      <button type="button" aria-pressed={visibility === 'public'} onclick={() => { visibility = 'public'; }}>Public</button>
      <button type="button" aria-pressed={visibility === 'members'} onclick={() => { visibility = 'members'; }}>Members only</button>
    </div>
    <input type="hidden" name="visibility" value={visibility} />
    <p class="muted">{visibility === 'public' ? 'Anyone signed in can see it, but only community members can take part.' : 'Only members of this community can see and join it.'}</p>
    <label for="image">Photo URL (optional)</label><input id="image" name="image_url" type="text" maxlength="500" placeholder="https://..." />
    <button disabled={busy}>{busy ? 'Posting...' : 'Post challenge'}</button>
    {#if busy}<Busy label="Posting your challenge" />{/if}
  </form>
</section>
