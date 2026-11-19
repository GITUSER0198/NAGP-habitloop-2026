import type { RequestEvent } from '@sveltejs/kit';
import { features } from '$lib/config/features';
import type { Activity, Cohort, DashboardData, DayCounts, Milestones, Summary, TodayItem } from '$lib/types';
import { api, ApiError } from './api';

async function optional<T>(event: RequestEvent, path: string, enabled = true): Promise<T | null> {
  if (!enabled) return null;
  try { return await api<T>(event, path); }
  catch (cause) { if (cause instanceof ApiError) return null; throw cause; }
}

export async function dashboard(event: RequestEvent): Promise<DashboardData> {
  const [today, activities, categories, summary, trend, heatmap, milestones, cohorts] = await Promise.all([
    api<TodayItem[]>(event, '/api/activities/today'),
    api<Activity[]>(event, '/api/activities'),
    features.categories ? api<Record<string, string>>(event, '/api/activities/categories') : {},
    optional<Summary>(event, '/api/analytics/summary'),
    optional<DayCounts[]>(event, '/api/analytics/trend'),
    optional<DayCounts[]>(event, '/api/analytics/heatmap', features.heatmap),
    optional<Milestones>(event, '/api/analytics/milestones', features.streakBadges),
    optional<Cohort[]>(event, '/api/analytics/cohorts', features.cohorts)
  ]);
  return { today, activities, categories, summary, trend, heatmap, milestones, cohorts };
}
