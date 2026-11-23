<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { beforeNavigate, invalidate } from '$app/navigation';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { PageProps } from './$types';
  import { rememberOpen } from '$lib/disclosure';
  import { app } from '$lib/config/app';
  import { formatDateTime } from '$lib/time';
  import Busy from '$lib/components/Busy.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Mapping from './Mapping.svelte';
  import ActionForms from '../ActionForms.svelte';
  import { type LinkSecret } from '../community';
  let { data, form }: PageProps = $props();
  let busy = $state(false);
  let now = $state(Date.now());
  let refreshError = $state('');
  let confirming = $state<string | null>(null);
  let removed = $state<string[]>([]);
  let deleteError = $state('');
  const watches = $derived(data.links.filter(link => link.provider === 'galaxywatch'));
  const simulators = $derived(data.providers.filter(provider => provider.provider !== 'galaxywatch'));
  function syncTime(value: string): string {
    const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60000));
    return minutes < 60 ? `${minutes} min ago` : formatDateTime(value);
  }
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
    let refreshing = false;
    let disposed = false;
    async function refresh(): Promise<void> {
      if (document.hidden || refreshing || busy || disposed) return;
      refreshing = true;
      try { await invalidate('wearable:stats'); if (!disposed) refreshError = ''; }
      catch { if (!disposed) refreshError = 'Refresh failed. Retrying in 10 seconds.'; }
      finally { refreshing = false; }
    }
    const timer = window.setInterval(() => void refresh(), 10000);
    const clock = window.setInterval(() => { now = Date.now(); }, 1000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('pagehide', forgetSecret);
    return () => {
      disposed = true; clearInterval(timer); clearInterval(clock);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('pagehide', forgetSecret); forgetSecret();
    };
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
  // Optimistic removal: hide the row at once, restore it if the server refuses, then refresh stats.
  const deleteWorkout: SubmitFunction = ({ formData }) => {
    const workoutId = String(formData.get('event_id') ?? '');
    removed = [...removed, workoutId]; confirming = null; deleteError = '';
    return async ({ result }) => {
      const restore = (message: string): void => { removed = removed.filter(item => item !== workoutId); deleteError = message; };
      try {
        if (result.type === 'success') { await invalidate('wearable:stats'); removed = removed.filter(item => item !== workoutId); }
        else restore(result.type === 'failure' && typeof result.data?.message === 'string' ? result.data.message : 'The workout could not be deleted. Try again.');
      } catch { restore('The workout was deleted but the list could not refresh. Reload the page.'); }
    };
  };
  async function copy(value: string): Promise<void> {
    try { await navigator.clipboard.writeText(value); copyMessage = 'Copied.'; }
    catch { copyMessage = 'Copy unavailable. Select the text and copy it manually.'; }
  }
</script>
<svelte:head><title>Wearables | {app.name}</title></svelte:head>
<div class="heading"><h1>Wearables</h1><span class="muted">Updated {Math.max(0, Math.floor((now - data.updatedAt) / 1000))} s ago</span></div>
{#if form?.message}<p class="notice" role="status">{form.message}</p>{/if}
{#if refreshError}<p role="status">{refreshError}</p>{/if}
{#if busy}<Busy label="Saving your wearable settings" />{/if}
<div class="wearables">
  {#if !watches.length}
    <section class="watch-status">
      <div class="watch-title"><Icon name="watch" size={32} /><h2>Your wearable</h2></div>
      <p>Pair from the phone app to see your Wear OS watch here.</p>
      <ol><li>Connect your watch to your phone.</li><li>Sign in to HabitLoop on the phone with the same account and community.</li><li>Open Wearables, tap Pair watch, then open HabitLoop on the watch.</li></ol>
    </section>
  {/if}
  {#each watches as watch (watch.id)}
    {@const stats = data.stats[watch.id]}
    <section class="watch-status" aria-label="Your wearable">
      <div class="watch-title"><Icon name="watch" size={32} /><div><span class="muted">Your wearable</span><h2>Wear OS watch</h2></div><span class="chip">Connected</span></div>
      <p class="muted">Linked {formatDateTime(watch.created_at)} &middot; {stats.last_sync_at ? `Last sync ${syncTime(stats.last_sync_at)}` : 'Waiting for the first sync'}</p>
    </section>
    <section aria-label="Today from your wearable">
      <h2>Today from your wearable</h2>
      {#if stats.pipeline.received}
        <div class="stats">
          <div><span>Steps today</span><strong>{stats.today.steps?.toLocaleString() ?? 'No data'}</strong></div>
          <div><span>Workouts today</span><strong>{stats.today.workouts}</strong></div>
          <div><span>Active minutes</span><strong>{stats.today.active_minutes}</strong></div>
          <div><span>Latest average heart rate</span><strong>{stats.latest_heart_rate === null ? 'No data' : `${stats.latest_heart_rate} bpm`}</strong></div>
        </div>
      {:else}<p class="muted">No wearable data yet. Sync steps or finish a workout on your watch.</p>{/if}
    </section>
    <section>
      <h2>Recent workouts</h2>
      {#if deleteError}<p class="error" role="alert">{deleteError}</p>{/if}
      {#if stats.workouts.some(row => !removed.includes(row.id))}
        <ul class="workouts">
          {#each stats.workouts.filter(row => !removed.includes(row.id)).slice(0, 20) as workout (workout.id)}
            <li>
              <svg class="workout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                {#if workout.type === 'cycle'}<circle cx="5" cy="17" r="4"/><circle cx="19" cy="17" r="4"/><path d="m5 17 5-10 5 10H5l8-7h4M8 7h4m3-3h3l2 5"/>
                {:else if workout.type === 'run'}<circle cx="15" cy="4" r="2"/><path d="m12 8 4 4 4-2M4 11l5-3 4 1-3 7-6 5m6-5 5 1 2 5"/>
                {:else}<circle cx="13" cy="4" r="2"/><path d="m7 21 3-7 2-6 3 5 4 1m-9 0 4 3 1 4M6 12l3-4h3"/>{/if}
              </svg>
              <div class="workout-body"><div class="workout-heading"><strong class="capitalize">{workout.type}</strong><span class="chip" class:rejected={workout.status === 'Rejected'}>{workout.status}</span>
                  {#if confirming !== workout.id}<button type="button" class="text icon-button" aria-label="Delete workout" title="Delete workout" onclick={() => { confirming = workout.id; }}><Icon name="trash" size={18} /></button>{/if}</div>
                {#if confirming === workout.id}
                  <form method="POST" action="?/deleteWorkout" use:enhance={deleteWorkout} class="confirm" aria-label="Confirm delete">
                    <input type="hidden" name="link_id" value={watch.id} /><input type="hidden" name="event_id" value={workout.id} />
                    <span>Delete this workout? It is removed from your stats.</span>
                    <button type="submit">Delete</button><button type="button" class="outlined" onclick={() => { confirming = null; }}>Cancel</button>
                  </form>
                {/if}
                <p>{workout.duration_min ?? 'Unknown'} min &middot; {workout.steps ?? 'Unknown'} steps &middot; {workout.avg_heart_rate === null ? 'Heart rate unavailable' : `${workout.avg_heart_rate} bpm`}</p>
                <time class="muted" datetime={workout.started_at}>{formatDateTime(workout.started_at)}</time>
                {#if workout.status === 'Rejected'}<p class="error">{workout.reason ?? 'No rejection reason supplied'}</p>{/if}
              </div>
            </li>
          {/each}
        </ul>
      {:else}<p class="muted">No workouts in the last 7 days.</p>{/if}
    </section>
    <section aria-label="7-day steps">
      <h2>7-day steps</h2>
      {#if stats.daily.some(day => day.steps !== null)}
        <hl-chart type="bar" data={JSON.stringify(stats.daily.map(day => ({ label: day.date, value: day.steps ?? 0 })))}></hl-chart>
        <p class="muted">Daily cumulative steps; days without readings show zero. Dates use {stats.timezone}.</p>
      {:else}<p class="muted">No step readings in the last 7 days.</p>{/if}
    </section>
    <section>
      <h2>Event pipeline</h2>
      <div class="pipeline"><span><strong>{stats.pipeline.received}</strong> received</span><span aria-hidden="true">&rarr;</span><span><strong>{stats.pipeline.normalized}</strong> normalized</span><span> &middot; <strong>{stats.pipeline.rejected}</strong> rejected</span></div>
      <p class="muted">EventBridge receives events, SQS queues them, and Lambda normalizes them into activity logs. Counts cover all events for this wearable.</p>
    </section>
  {/each}
  {#if watches.length}
    <details use:rememberOpen={'wearable-mapping'}><summary>Activity mapping</summary>
      <p class="muted">Choose the habit each workout type updates. Skipped types are rejected by the pipeline.</p>
      {#each watches as watch (watch.id)}
        <Mapping id={watch.id} types={data.providers.find(provider => provider.provider === watch.provider)?.activity_types ?? []} map={watch.activity_map} activities={data.activities} {busy} {submit} />
      {/each}
      {#if !data.activities.length}<p><a href="/activities/new">Create a habit</a> to map your wearable activities.</p>{/if}
    </details>
  {/if}
  <details use:rememberOpen={'wearable-simulator'}><summary>Developer simulator (for testing without a device)</summary>
    <p class="muted">Sends signed test events through the same EventBridge, SQS and Lambda pipeline.</p>
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

    {#each simulators as provider (provider.provider)}
      <section class="simulator"><h3>{provider.provider}</h3>
        {#each data.links.filter(link => link.provider === provider.provider) as link (link.id)}
          <p class="muted">Linked {formatDateTime(link.created_at)}</p>
          <Mapping id={link.id} types={provider.activity_types} map={link.activity_map} activities={data.activities} {busy} {submit} />
          <ActionForms id={link.id} actions={[{ action: 'unlink', label: 'Disconnect' }]} {submit} />
        {:else}
          <form method="POST" action="?/link" use:enhance={submit}>
            <input type="hidden" name="provider" value={provider.provider} />
            {#each provider.activity_types as type}
              <div class="mapping-row"><label for={`${provider.provider}-${type}`}>{type}</label>
                <select id={`${provider.provider}-${type}`} name={`map:${type}`}><option value="">Skip this type</option>
                  {#each data.activities as activity}<option value={activity.id}>{activity.name}</option>{/each}
                </select>
              </div>
            {/each}
            <button disabled={busy || !data.activities.length}>Link {provider.provider}</button>
            {#if !data.activities.length}<p><a href="/activities/new">Create a habit</a> before linking a simulator.</p>{/if}
          </form>
        {/each}
      </section>
    {/each}
    <details use:rememberOpen={'partner-events'}><summary>Recent simulator events</summary>
      <ul class="history">{#each data.events.filter(event => data.links.some(link => link.id === event.link_id && link.provider !== 'galaxywatch')) as event (event.id)}
        <li><strong>{event.status}</strong> at {formatDateTime(event.received_at)}{#if event.reason}<p class="error">{event.reason}</p>{/if}</li>
      {:else}<li>No simulator events yet.</li>{/each}</ul>
    </details>
  </details>
</div>
<style>
  .heading, .watch-title, .workout-heading { display: flex; align-items: center; flex-wrap: wrap; gap: .75rem; }
  .heading { justify-content: space-between; }
  .wearables { max-width: 56rem; display: grid; gap: 2rem; margin-top: 1rem; }
  h2, h3, p { margin: 0 0 .75rem; }
  .muted, .stats span { color: var(--hl-text-muted); font-size: .9rem; }
  .watch-status { background: var(--hl-surface-container); padding: 1.5rem; border-radius: var(--hl-radius); }
  .watch-status p { margin: .75rem 0 0; }
  .watch-title > :global(svg) { color: var(--hl-accent); }
  .watch-title h2 { margin: 0; }
  .chip { display: inline-flex; padding: .15rem .65rem; font-size: .8rem; border-radius: var(--hl-radius-pill); background: var(--hl-accent-container); color: var(--hl-on-accent-container); }
  .rejected { background: var(--hl-surface-2); color: var(--hl-danger); }
  .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1.5rem; padding: 1rem 0; }
  .stats span, .stats strong { display: block; }
  .stats strong { font-size: 1.7rem; margin-top: .5rem; }
  .workouts { list-style: none; padding: 0; margin: 0; }
  .workouts li { display: flex; gap: 1rem; padding: 1rem 0; }
  .workout-icon { flex: none; width: 28px; height: 28px; color: var(--hl-accent); }
  .workout-body { min-width: 0; flex: 1; }
  .workout-body p { margin: .35rem 0; overflow-wrap: anywhere; }
  .workout-heading { justify-content: space-between; }
  .icon-button { min-height: 2rem; padding: .25rem .5rem; color: var(--hl-danger); }
  .confirm { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; margin: .35rem 0; }
  .capitalize, label { text-transform: capitalize; }
  .pipeline { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; margin: 1rem 0; }
  .pipeline strong { color: var(--hl-accent); }
  details { border-top: 1px solid var(--hl-border); padding-top: 1rem; }
  summary { cursor: pointer; font-weight: 600; margin-bottom: 1rem; }
  .mapping-row { display: grid; grid-template-columns: minmax(4rem, 1fr) minmax(0, 3fr); align-items: center; gap: 1rem; margin-bottom: .75rem; }
  select { margin: 0; width: 100%; }
  .simulator { margin: 1.5rem 0; }
  .secret { margin-bottom: 1.5rem; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--hl-surface-2); padding: 1rem; border-radius: var(--hl-radius); }
  @media (max-width: 600px) { .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.25rem; } .watch-status { padding: 1rem; } }
</style>
