<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { PageProps } from './$types';
  import { rememberOpen } from '$lib/disclosure';
  import { app } from '$lib/config/app';
  import { formatDateTime } from '$lib/time';
  import Busy from '$lib/components/Busy.svelte';
  import ActionForms from '../ActionForms.svelte';
  import { submitAction, type LinkSecret } from '../community';
  let { data, form }: PageProps = $props();
  let busy = $state(false);
  let secret = $state<LinkSecret | null>(untrack(() => form && 'secret' in form ? form.secret ?? null : null));
  let copyMessage = $state('');
  const command = $derived(secret ? `npm run simulate -- --link-id ${secret.id} --key ${secret.ingest_key} --provider-activity ${secret.providerActivity} --count 3 --replay` : '');
  function forgetSecret(): void {
    secret = null;
    copyMessage = '';
    if (form && 'secret' in form) form.secret = undefined;
  }
  beforeNavigate(forgetSecret);
  onMount(() => {
    if (form && 'secret' in form) form.secret = undefined;
    window.addEventListener('pagehide', forgetSecret);
    return () => { window.removeEventListener('pagehide', forgetSecret); forgetSecret(); };
  });
  const submit: SubmitFunction = ({ cancel }) => {
    if (busy) { cancel(); return; }
    busy = true;
    return async ({ result, update }) => {
      try {
        let received: LinkSecret | null = null;
        if (result.type === 'success' && result.data && 'secret' in result.data) {
          received = result.data.secret as LinkSecret;
          delete result.data.secret;
        }
        forgetSecret();
        await update();
        secret = received;
      } finally { busy = false; }
    };
  };
  async function copy(value: string): Promise<void> {
    try { await navigator.clipboard.writeText(value); copyMessage = 'Copied.'; }
    catch { copyMessage = 'Copy unavailable. Select the text and copy it manually.'; }
  }
  function focusMapping(provider: string): void {
    const field = document.getElementById(`mapping-${provider}`);
    field?.scrollIntoView({ block: 'center' });
    field?.focus();
  }
</script>
<svelte:head><title>Wearables | {app.name}</title></svelte:head>
<h1>Wearable integrations</h1>
{#if form?.message}<p class="notice" role="status">{form.message}</p>{/if}
{#if busy}<Busy label="Updating your integrations" />{/if}
{#if secret}
  <section class="card secret" aria-label="One-time ingest key">
    <h2>Save your ingest key</h2><p>This key disappears when you leave this page. Keep it somewhere private.</p>
    <label for="ingest-key">Ingest key</label><input id="ingest-key" readonly value={secret.ingest_key} autocomplete="off" />
    <button type="button" onclick={() => void copy(secret!.ingest_key)}>Copy key</button>
    <p>Run this command from the project folder (Node 22, after `npm ci`). It sends three workouts and verifies replay handling. The simulator uses the gateway port from your environment, or the local default.</p>
    <pre><code>{command}</code></pre><button type="button" onclick={() => void copy(command)}>Copy simulator command</button>
    <button type="button" class="secondary" onclick={forgetSecret}>Hide key</button>
    {#if copyMessage}<p role="status">{copyMessage}</p>{/if}
  </section>
{/if}
<div class="dashboard-grid">
  {#each data.providers as provider (provider.provider)}
    {@const links = data.links.filter(link => link.provider === provider.provider)}
    {@const events = data.events.filter(event => links.some(link => link.id === event.link_id))}
    <section class="stack">
      <hl-partner-tile id={`provider-${provider.provider}`} provider={provider.provider} linked={links.length > 0} {busy}
        last-event-at={events[0]?.received_at} rejected-count={events.filter(event => event.status === 'rejected').length}
        onhlConnect={() => focusMapping(provider.provider)} onhlDisconnect={() => submitAction(`${links[0]?.id}-unlink`)}></hl-partner-tile>
      {#if !links.length}
        <form class="card" method="POST" action="?/link" use:enhance={submit}>
          <h2>Map {provider.provider} activities</h2><p>Choose which habit each workout should update. Unmapped workout types will be rejected.</p>
          <input type="hidden" name="provider" value={provider.provider} />
          {#each provider.activity_types as type, index}
            <label for={index === 0 ? `mapping-${provider.provider}` : `${provider.provider}-${type}`}>{type}</label>
            <select id={index === 0 ? `mapping-${provider.provider}` : `${provider.provider}-${type}`} name={`map:${type}`}>
              <option value="">Do not import</option>
              {#each data.activities as activity}<option value={activity.id}>{activity.name}</option>{/each}
            </select>
          {/each}
          {#if !data.activities.length}<p>Create an activity before linking. <a href="/activities/new">New activity</a></p>{/if}
          <button disabled={busy || !data.activities.length}>Link {provider.provider}</button>
        </form>
      {:else}
        {#each links as link (link.id)}
          <div class="card">
            <p>Linked {formatDateTime(link.created_at)}</p>
            <ul>{#each Object.entries(link.activity_map) as [type, id]}<li>{type}: {data.activities.find(activity => activity.id === id)?.name ?? 'Activity removed'}</li>{/each}</ul>
            <ActionForms id={link.id} actions={[{ action: 'unlink', label: 'Disconnect' }]} {submit} />
          </div>
        {/each}
      {/if}
    </section>
  {/each}
</div>
<details class="card" use:rememberOpen={'partner-events'}><summary>Recent events ({data.events.length})</summary>
  <form method="POST" action="?/events" use:enhance={submit}><button disabled={busy}>Refresh events</button></form>
  {#if data.events.length}<ul class="history">
    {#each data.events as event (event.id)}<li><strong>{event.status}</strong>: {event.event_id} at {formatDateTime(event.received_at)}
      {#if event.reason}<p class="error">Reason: {event.reason}</p>{/if}
    </li>{/each}
  </ul>{:else}<p>No partner events yet. Run the simulator after linking.</p>{/if}
</details>
<style>
  .secret { margin-bottom: 1.5rem; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--hl-surface-2); padding: 1rem; border-radius: var(--hl-radius); }
</style>
