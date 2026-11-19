<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { PageProps } from './$types';
  import { features } from '$lib/config/features';
  import { app } from '$lib/config/app';
  import { rememberOpen } from '$lib/disclosure';
  import Busy from '$lib/components/Busy.svelte';
  import ActionForms from '../ActionForms.svelte';
  import { submitAction } from '../community';
  import { useCommunity } from '../community.svelte';
  let { data, form }: PageProps = $props();
  const community = useCommunity();
  let busy = $state(false);
  $effect(() => { community.invites = data.invites.length; });
  const submit: SubmitFunction = ({ cancel }) => {
    if (busy) { cancel(); return; }
    busy = true;
    return async ({ update }) => { try { await update(); } finally { busy = false; } };
  };
</script>
<svelte:head><title>Challenges | {app.name}</title></svelte:head>
<h1>Challenges</h1>
{#if form?.message}<p role="status" class="notice">{form.message}</p>{/if}
{#if form && 'errors' in form}{#each Object.entries(form.errors ?? {}) as [key, message]}<p class="error">{key}: {message}</p>{/each}{/if}
{#if busy}<Busy label="Updating challenges" />{/if}
<div class="dashboard-grid">
  <section class="stack" aria-label="Challenge feed">
    {#if data.invites.length}
      <section class="stack"><h2>Pending invitations ({data.invites.length})</h2>
        {#each data.invites as challenge (challenge.id)}
          <div>
            <a href={`/challenges/${challenge.id}`}>View {challenge.title}</a>
            <hl-challenge-card title={challenge.title} visibility={challenge.visibility} target={challenge.target_count} invited {busy}
              onhlAccept={() => submitAction(`${challenge.id}-accept`)} onhlDecline={() => submitAction(`${challenge.id}-decline`)}></hl-challenge-card>
            <ActionForms id={challenge.id} actions={[{ action: 'accept', label: 'Accept invitation' }, { action: 'decline', label: 'Decline invitation' }]} {submit} />
          </div>
        {/each}
      </section>
    {/if}
    <h2>Challenge feed</h2>
    {#each data.challenges.filter(challenge => !data.invites.some(invite => invite.id === challenge.id)) as challenge (challenge.id)}
      <div>
        <a href={`/challenges/${challenge.id}`}>View {challenge.title}</a>
        <hl-challenge-card title={challenge.title} visibility={challenge.visibility} target={challenge.target_count} {busy}
          joined={challenge.owner_id === data.user?.id || (form && 'joined' in form && form.joined === challenge.id) || false}
          onhlJoin={() => submitAction(`${challenge.id}-join`)}></hl-challenge-card>
        {#if challenge.visibility === 'public'}<ActionForms id={challenge.id} actions={[{ action: 'join', label: 'Join challenge' }]} {submit} />{/if}
      </div>
    {:else}<p class="muted">No other challenges yet. Create one or join with a code.</p>{/each}
  </section>
  <div class="stack">
    <section class="card"><h2>Join by code</h2>
      <form method="POST" action="?/joinCode" use:enhance={submit}>
        <label for="invite-code">Invite code</label><input id="invite-code" name="invite_code" required maxlength="8" minlength="8" />
        <button disabled={busy}>Join with code</button>
      </form>
    </section>
    <details class="card" use:rememberOpen={'create-challenge'}><summary>Create a challenge</summary>
      <form method="POST" action="?/create" use:enhance={submit}>
        <label for="title">Title</label><input id="title" name="title" required maxlength="200" />
        <label for="description">Description</label><input id="description" name="description" maxlength="10000" />
        <label for="visibility">Visibility</label><select id="visibility" name="visibility"><option value="public">Public</option><option value="private">Private</option></select>
        {#if features.categories}
          <label for="category">Activity category</label><select id="category" name="activity_category" required>
            {#each Object.keys(data.categories) as category}<option value={category}>{category}</option>{/each}
          </select>
        {:else}<input type="hidden" name="activity_category" value="other" />{/if}
        <label for="start">Start date</label><input id="start" name="start_date" type="date" required />
        <label for="end">End date</label><input id="end" name="end_date" type="date" required />
        <label for="target">Target count</label><input id="target" name="target_count" type="number" min="1" step="1" value="7" required />
        <button disabled={busy}>Create challenge</button>
      </form>
    </details>
  </div>
</div>
