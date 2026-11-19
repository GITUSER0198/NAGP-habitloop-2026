import { getContext, setContext } from 'svelte';
import type { DashboardData, TodayItem } from '$lib/types';
import { SummaryState } from './summary.svelte';
import { TodayState } from './today.svelte';
import { ToastState } from './toasts.svelte';

export class AppState {
  summary = new SummaryState();
  today = new TodayState();
  toasts = new ToastState();
  connection = $state('Connecting');
  refresh: () => Promise<void> = async () => {};
  constructor(items: TodayItem[]) { this.today.items = items; }
  apply(data: DashboardData): void {
    this.today.items = data.today;
    this.today.activities = data.activities;
    this.today.categories = data.categories;
    this.summary.value = data.summary;
    this.summary.trend = data.trend;
    this.summary.heatmap = data.heatmap;
    this.summary.milestones = data.milestones;
    this.summary.cohorts = data.cohorts;
  }
}
const key = Symbol('habitloop-state');
export function provideState(items: TodayItem[]): AppState { return setContext(key, new AppState(items)); }
export function useAppState(): AppState { return getContext<AppState>(key); }
