import type { Cohort, DayCounts, Milestones, Summary } from '$lib/types';

export class SummaryState {
  value = $state<Summary | null>(null);
  trend = $state<DayCounts[] | null>(null);
  heatmap = $state<DayCounts[] | null>(null);
  milestones = $state<Milestones | null>(null);
  cohorts = $state<Cohort[] | null>(null);
  successes = $derived(this.value ? this.value.today.done + this.value.today.completed : 0);
  rate = $derived(this.value ? Math.round(this.value.rate_7d * 100) : 0);
  chart = $derived(this.trend?.map(day => ({ label: day.date, value: day.done + day.completed })) ?? []);
}
