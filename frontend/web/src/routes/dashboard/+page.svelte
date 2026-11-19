<script lang="ts">
  import { untrack } from 'svelte';
  import type { PageProps } from './$types';
  import { useAppState } from '$lib/state/app.svelte';
  import { features } from '$lib/config/features';
  import { app } from '$lib/config/app';
  import { logNow } from '$lib/log.svelte';
  import { rememberOpen } from '$lib/disclosure';
  import { formatTime } from '$lib/time';
  import Busy from '$lib/components/Busy.svelte';

  let { data }: PageProps = $props();
  const model = useAppState();
  model.apply(untrack(() => data.dashboard));
  $effect(() => { model.apply(data.dashboard); });
</script>
<svelte:head><title>Dashboard | {app.name}</title></svelte:head>
<div class="page-heading"><div><p class="eyebrow">Keep your loop going</p><h1>Dashboard</h1></div><a class="button" href="/activities/new">New activity</a></div>
<p class="muted" role="status">{model.connection}</p>
<div class="dashboard-grid">
  <section aria-labelledby="today-heading"><div class="page-heading"><h2 id="today-heading">{app.strings.today}</h2><span>{model.today.remaining} left</span></div>
    <div class="activity-list">
      {#each model.today.items as item (item.id)}
        <div>
          {#if features.categories}<p class="category"><i class={`ti ${model.today.categories[item.category] ?? ''}`} aria-hidden="true"></i> {item.category}</p>{/if}
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
  <div class="stack">
    <section class="card" aria-labelledby="summary-heading"><h2 id="summary-heading">{app.strings.summary}</h2>
      {#if model.summary.value}
        <dl class="summary-grid">
          <div><dt>Done today</dt><dd data-testid="summary-done">{model.summary.value.today.done}</dd></div>
          <div><dt>Completed today</dt><dd>{model.summary.value.today.completed}</dd></div>
          <div><dt>Missed today</dt><dd>{model.summary.value.today.missed}</dd></div>
          <div><dt>7-day success rate</dt><dd>{model.summary.rate}%</dd></div>
          <div><dt>Current streak</dt><dd>{model.summary.value.current_streak} days</dd></div>
          <div><dt>Best streak</dt><dd>{model.summary.value.best_streak} days</dd></div>
        </dl>
      {:else}<p role="status">{app.strings.unavailable}: analytics could not be reached.</p>{/if}
    </section>
    <section class="card"><h2>{app.strings.trend}</h2>
      {#if model.summary.trend}<hl-chart id="dashboard-trend" type="trend" data={JSON.stringify(model.summary.chart)}></hl-chart>
      {:else}<p>{app.strings.unavailable}</p>{/if}
    </section>
    {#if features.streakBadges}
      <section class="card"><h2>{app.strings.milestones}</h2>
        {#if model.summary.milestones}<div class="badges">
          {#each app.milestoneDays as days}
            {@const earned = model.summary.milestones.overall.earned.find(badge => badge.days === days)}
            <hl-badge id={`badge-${days}`} {days} earned={!!earned} earned-at={earned?.earned_date}
              remaining={Math.max(0, days - model.summary.milestones.overall.current_streak)}></hl-badge>
          {/each}
        </div>{:else}<p>{app.strings.unavailable}</p>{/if}
      </section>
    {/if}
  </div>
</div>
{#if features.heatmap}
  <section class="card heatmap"><h2>{app.strings.heatmap}</h2>
    {#if model.summary.heatmap}<hl-heatmap id="dashboard-heatmap" data={JSON.stringify(model.summary.heatmap)}></hl-heatmap>{:else}<p>{app.strings.unavailable}</p>{/if}
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
