<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageProps } from './$types';
  import type { ActivityValues, FieldErrors } from '$lib/types';
  import { app } from '$lib/config/app';
  import { useAppState } from '$lib/state/app.svelte';
  import { rememberOpen } from '$lib/disclosure';
  import { formatDateTime } from '$lib/time';
  import ActivityForm from '$lib/components/ActivityForm.svelte';
  import Busy from '$lib/components/Busy.svelte';

  let { data, form }: PageProps = $props();
  const model = useAppState();
  let busy = $state(false);
  const values = $derived(form && 'values' in form ? form.values as ActivityValues : undefined);
  const errors = $derived(form && 'errors' in form ? form.errors as FieldErrors : undefined);
  const logErrors = $derived(form && 'logErrors' in form ? form.logErrors as FieldErrors : undefined);
</script>
<svelte:head><title>{data.activity.name} | {app.name}</title></svelte:head>
<div class="page-heading"><h1>{data.activity.name}</h1><a href="/dashboard">Back to dashboard</a></div>
{#if data.created}<p role="status" class="notice">Activity created. You can log it below.</p>{/if}
<div class="dashboard-grid">
  <section class="card"><h2>Log this activity</h2>
    <p class="muted">Done: made progress. Completed: met the full target. Missed: skipped this time.</p>
    <form method="POST" action="?/log" aria-busy={busy} use:enhance={() => {
      busy = true;
      return async ({ update, result }) => {
        try { await update(); if (result.type === 'success') { model.toasts.push(app.strings.logSaved); await model.refresh(); } }
        finally { busy = false; }
      };
    }}>
      <fieldset aria-describedby="log-error"><legend>Status</legend><div class="actions">
        <button name="status" value="done" disabled={busy}>Log done</button>
        <button name="status" value="completed" disabled={busy}>Log completed</button>
        <button name="status" value="missed" disabled={busy} class="secondary">Log missed</button>
      </div><small class="error" id="log-error">{logErrors?.status ?? ''}</small></fieldset>
      {#if form && 'logged' in form && form.logged}<p role="status">{app.strings.logSaved}</p>{/if}
      {#if busy}<Busy label="Logging your activity" />{/if}
    </form>
    <details use:rememberOpen={`logs:${data.activity.id}`}><summary>Log history ({data.logs.length})</summary>
      {#if data.logs.length}<ul class="history">
        {#each [...data.logs].reverse() as log (log.id)}<li><strong>{log.status}</strong> · {formatDateTime(log.logged_at)} · {log.source}{log.duration_min !== null ? ` · ${log.duration_min} min` : ''}</li>{/each}
      </ul>{:else}<p class="muted">No logs yet.</p>{/if}
    </details>
  </section>
  <section class="card"><h2>Edit activity</h2>
    <ActivityForm activity={data.activity} categories={data.categories} {values} {errors} action="?/edit" label="Save changes" />
    {#if form && 'saved' in form && form.saved}<p role="status">{app.strings.activitySaved}</p>{/if}
  </section>
</div>
