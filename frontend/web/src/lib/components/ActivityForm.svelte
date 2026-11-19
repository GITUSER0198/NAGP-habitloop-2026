<script lang="ts">
  import { enhance } from '$app/forms';
  import type { Activity, ActivityValues, FieldErrors } from '$lib/types';
  import { features } from '$lib/config/features';
  import { formatTime, parseTime } from '$lib/time';
  import { app } from '$lib/config/app';
  import { useAppState } from '$lib/state/app.svelte';
  import Busy from './Busy.svelte';

  let { activity, categories, values, errors = {}, action = '', label = 'Create activity' }: {
    activity?: Activity; categories: Record<string, string>; values?: ActivityValues;
    errors?: FieldErrors; action?: string; label?: string;
  } = $props();
  const model = useAppState();
  let busy = $state(false);
  let timeError = $state('');
  let timeInput: HTMLInputElement;
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  let frequency = $state<Activity['frequency']>('daily');
  $effect(() => { frequency = (values?.frequency ?? activity?.frequency ?? 'daily') as Activity['frequency']; });
  const selectedDays = $derived(values?.days_of_week ?? activity?.days_of_week ?? []);

  function normalizeTime(): void {
    const parsed = parseTime(timeInput.value);
    timeError = parsed ? '' : 'Enter a time such as 9:30 PM.';
    if (parsed) timeInput.value = formatTime(parsed);
  }
</script>

<form method="POST" {action} aria-busy={busy} use:enhance={() => {
  busy = true;
  return async ({ update, result }) => {
    try {
      await update();
      if (result.type === 'success') { model.toasts.push(app.strings.activitySaved); await model.refresh(); }
    } finally { busy = false; }
  };
}}>
  {#if errors._form}<p class="error" role="alert">{errors._form}</p>{/if}
  <label for="activity-name">Activity name</label>
  <input id="activity-name" name="name" required maxlength="200" value={values?.name ?? activity?.name ?? ''} aria-invalid={!!errors.name} aria-describedby="name-error" />
  <small id="name-error" class="error">{errors.name ?? ''}</small>

  {#if features.categories}
    <fieldset aria-describedby="category-error"><legend>Category</legend>
      <div class="chips">
        {#each Object.entries(categories) as [category, icon]}
          <label class="chip"><input type="radio" name="category" value={category} checked={(values?.category ?? activity?.category ?? 'other') === category} required />
            <i class={`ti ${icon}`} aria-hidden="true"></i> {category}</label>
        {/each}
      </div>
      <small id="category-error" class="error">{errors.category ?? ''}</small>
    </fieldset>
  {/if}

  <label for="frequency">Frequency</label>
  <select id="frequency" name="frequency" bind:value={frequency} aria-invalid={!!errors.frequency} aria-describedby="frequency-error">
    <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="custom">Custom</option>
  </select>
  <small id="frequency-error" class="error">{errors.frequency ?? ''}</small>
  <fieldset aria-describedby="days-error"><legend>Days of the week {frequency === 'daily' ? '(daily uses every day)' : ''}</legend>
    <div class="chips">
      {#each days as day, index}
        <label class="chip"><input type="checkbox" name="days_of_week" value={index} checked={selectedDays.includes(index)} />{day}</label>
      {/each}
    </div>
    <small id="days-error" class="error">{errors.days_of_week ?? ''}</small>
  </fieldset>

  <label for="preferred-time">Preferred time</label>
  <input bind:this={timeInput} id="preferred-time" name="preferred_time" required placeholder="e.g. 9:30 PM"
    value={values?.preferred_time ?? formatTime(activity?.preferred_time ?? '09:00')} onblur={normalizeTime}
    aria-invalid={!!(timeError || errors.preferred_time)} aria-describedby="time-error" />
  <small id="time-error" class="error">{timeError || errors.preferred_time || ''}</small>
  <p class="muted">Times use your account timezone.</p>

  <label for="target">Target per week</label>
  <input id="target" name="target_per_week" type="number" min="1" max="7" step="1" required value={values?.target_per_week ?? activity?.target_per_week ?? 7} aria-invalid={!!errors.target_per_week} aria-describedby="target-error" />
  <small id="target-error" class="error">{errors.target_per_week ?? ''}</small>
  <button disabled={busy} type="submit">{busy ? 'Saving activity' : label}</button>
  {#if busy}<Busy label="Saving your activity" />{/if}
</form>
