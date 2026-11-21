<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import type { PageProps } from './$types';
  import { useAppState } from '$lib/state/app.svelte';
  import { features } from '$lib/config/features';
  import { app } from '$lib/config/app';
  import { logNow } from '$lib/log.svelte';
  import { rememberOpen } from '$lib/disclosure';
  import { formatTime } from '$lib/time';
  import Busy from '$lib/components/Busy.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { cardValue } from '../community';

  let { data, form }: PageProps = $props();
  const model = useAppState();
  model.apply(untrack(() => data.dashboard));
  $effect(() => { model.apply(data.dashboard); });

  let hour = $state<number | null>(null);
  let accepting = $state(false);
  onMount(() => { hour = new Date().getHours(); });
  const greeting = $derived(hour === null ? 'Welcome back' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');
  const firstName = $derived(data.user?.name.trim().split(/\s+/)[0] ?? '');
  const total = $derived(model.today.items.length);
  const finished = $derived(model.today.items.filter(item => item.status).length);
  const percent = $derived(total ? Math.round(finished / total * 100) : 0);
  const suggestionName = $derived(data.suggestion
    ? model.today.activities.find(activity => activity.id === data.suggestion?.activity_id)?.name ?? 'Your activity' : '');
</script>
<svelte:head><title>Dashboard | {app.name}</title></svelte:head>
<div class="dash">
  <section class="hero" aria-labelledby="hero-heading">
    <div class="hero-main">
      <p class="eyebrow">Keep your loop going</p>
      <h1 id="hero-heading">{greeting}{firstName ? `, ${firstName}` : ''}</h1>
      <p role="status" class="status-line">{model.connection}</p>
    </div>
    <div class="hero-progress">
      <strong>{total ? `${finished} of ${total} done` : 'No habits scheduled today'}</strong>
      <div class="track" role="progressbar" aria-label="Today's progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${finished} of ${total} done`}><span style={`width: ${percent}%`}></span></div>
      <span class="pill">{model.today.remaining} left today</span>
    </div>
  </section>

  {#if model.summary.value}
    <dl class="stat-grid" aria-label={app.strings.summary}>
      <div class="card stat"><span class="icon-tile"><Icon name="check" /></span>
        <div><dt>Done today</dt><dd data-testid="summary-done">{model.summary.value.today.done}</dd>
          <small><span>Completed <span data-testid="summary-completed">{model.summary.value.today.completed}</span></span><span>Missed <span data-testid="summary-missed">{model.summary.value.today.missed}</span></span></small></div></div>
      <div class="card stat"><span class="icon-tile"><Icon name="chart" /></span>
        <div><dt>7-day success rate</dt><dd>{model.summary.rate}%</dd></div></div>
      <div class="card stat"><span class="icon-tile"><Icon name="flame" /></span>
        <div><dt>Current streak</dt><dd>{model.summary.value.current_streak} days</dd></div></div>
      <div class="card stat"><span class="icon-tile"><Icon name="trophy" /></span>
        <div><dt>Best streak</dt><dd>{model.summary.value.best_streak} days</dd></div></div>
    </dl>
  {:else}<p class="card" role="status">{app.strings.unavailable}: analytics could not be reached.</p>{/if}

  <div class="dash-main">
    <section aria-labelledby="today-heading">
      <div class="section-head"><h2 id="today-heading">{app.strings.today}</h2><a class="button" href="/activities/new">New activity</a></div>
      <div class="activity-list">
        {#each model.today.items as item (item.id)}
          <div>
            {#if features.categories}
              <hl-activity-summary id={`activity-${item.id}`} name={item.name} category={item.category}
                preferred-time={item.preferred_time} status={item.status ?? 'Not logged'}
                streak={features.streakBadges ? model.summary.milestones?.activities.find(entry => entry.activity_id === item.id)?.current_streak ?? 0 : 0}
                busy={model.today.busy[item.id] ?? false} onhlLog={(event) => void logNow(model, item.id, event.detail.status)}></hl-activity-summary>
            {:else}
              <article class="card"><h2>{item.name}</h2><p>{formatTime(item.preferred_time)}</p><p>Status: {item.status ?? 'Not logged'}</p>
                <div class="actions">{#each ['done', 'completed', 'missed'] as status}
                  <button disabled={model.today.busy[item.id] ?? false} onclick={() => void logNow(model, item.id, status as import('$lib/types').Status)}>Log {status}</button>
                {/each}</div>
              </article>
            {/if}
            {#if model.today.busy[item.id]}<Busy label={`Logging ${item.name}`} />{/if}
            {#if model.today.errors[item.id]}<p class="error" role="alert">{model.today.errors[item.id]}</p>{/if}
            <a class="edit-link" href={`/activities/${item.id}`}>Edit or view logs for {item.name}</a>
          </div>
        {:else}<p class="card muted">{app.strings.emptyToday} <a href="/activities/new">Create an activity</a></p>{/each}
      </div>
    </section>
    <div class="dash-side">
      {#if features.recommendations}
        <section class="card suggestion" aria-labelledby="suggestion-heading">
          <div class="card-head"><span class="icon-tile"><Icon name="bulb" /></span><h2 id="suggestion-heading">Next suggestion</h2>
            {#if data.suggestion}<span class="pill tonal">{data.suggestion.kind}</span>{/if}</div>
          {#if form?.message}<p class="notice" role="status">{form.message}</p>{/if}
          {#if data.suggestion}
            <p><strong>{suggestionName}</strong></p>
            <p>{cardValue(data.suggestion, false)} to <strong>{cardValue(data.suggestion, true)}</strong></p>
            <p class="muted reason">{data.suggestion.reason}</p>
            <div class="actions">
              <form method="POST" action="?/accept" use:enhance={() => {
                accepting = true;
                return async ({ update }) => { try { await update({ reset: false }); } finally { accepting = false; } };
              }}>
                <input type="hidden" name="id" value={data.suggestion.id} />
                <button type="submit" disabled={accepting}>Accept</button>
              </form>
              <a class="button outlined" href="/recommendations">See all</a>
            </div>
            {#if accepting}<Busy label="Applying the suggestion" />{/if}
          {:else}
            <p class="muted">No pending suggestions. Log a few more days, then refresh from Recommendations.</p>
            <a class="button outlined" href="/recommendations">Open recommendations</a>
          {/if}
        </section>
      {/if}
      {#if features.streakBadges}
        <section aria-labelledby="milestones-heading"><div class="section-head"><h2 id="milestones-heading">{app.strings.milestones}</h2></div>
          {#if model.summary.milestones}<div class="badges">
            {#each app.milestoneDays as days}
              {@const earned = model.summary.milestones.overall.earned.find(badge => badge.days === days)}
              <hl-badge id={`badge-${days}`} {days} earned={!!earned} earned-at={earned?.earned_date}
                remaining={Math.max(0, days - model.summary.milestones.overall.current_streak)}></hl-badge>
            {/each}
          </div>{:else}<p class="card">{app.strings.unavailable}</p>{/if}
        </section>
      {/if}
    </div>
  </div>

  <section aria-labelledby="trend-heading"><div class="section-head"><h2 id="trend-heading">{app.strings.trend}</h2></div>
    {#if model.summary.trend}<hl-chart id="dashboard-trend" type="stacked" data={JSON.stringify(model.summary.stacked)}></hl-chart>
    {:else}<p class="card">{app.strings.unavailable}</p>{/if}
  </section>
  {#if features.heatmap}
    <section aria-labelledby="heatmap-heading"><div class="section-head"><h2 id="heatmap-heading">{app.strings.heatmap}</h2></div>
      {#if model.summary.heatmap}<hl-heatmap id="dashboard-heatmap" data={JSON.stringify(model.summary.heatmap)}></hl-heatmap>{:else}<p class="card">{app.strings.unavailable}</p>{/if}
    </section>
  {/if}
  <details class="card" use:rememberOpen={'dashboard-history'}><summary>{app.strings.history} ({model.today.activities.length})</summary>
    <ul class="history">{#each model.today.activities as item (item.id)}<li><a href={`/activities/${item.id}`}>{item.name}</a> · {formatTime(item.preferred_time)} · {item.frequency}</li>{:else}<li>No activities yet.</li>{/each}</ul>
  </details>
  {#if features.cohorts}
    <details class="card" use:rememberOpen={'dashboard-cohorts'}><summary>{app.strings.cohorts} ({model.summary.cohorts?.length ?? 0})</summary>
      {#if model.summary.cohorts}<ul class="history">{#each model.summary.cohorts as cohort}<li>{cohort.week}: {cohort.successes} of {cohort.attempts} successful ({Math.round(cohort.rate * 100)}%)</li>{:else}<li>No cohort history yet.</li>{/each}</ul>{:else}<p>{app.strings.unavailable}</p>{/if}
    </details>
  {/if}
</div>
