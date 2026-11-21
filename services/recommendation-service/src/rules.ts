import type { ScheduleValue } from './db/schema.js';

export const NEEDS_DATA = 'needs at least 3 logs per time window';
export type Confidence = 'low' | 'medium' | 'high';
export type ActivityHistory = { id: string; tenant_id: string; user_id: string; name: string; frequency: 'daily' | 'weekly' | 'custom'; preferred_time: string; target_per_week: number; active: boolean };
export type HourHistory = { hour: number; attempts: number; successes: number };
export type LogHistory = { tenant_id: string; user_id: string; activity_id: string; status: 'done' | 'completed' | 'missed'; logged_at: Date };
export type Suggestion = { activity: ActivityHistory; kind: 'timing' | 'frequency'; current_value: ScheduleValue; suggested_value: ScheduleValue; reason: string; confidence: Confidence };

export function confidence(attempts: number): Confidence {
  if (attempts >= 30) return 'high';
  if (attempts >= 10) return 'medium';
  return 'low';
}
export function displayHour(hour: number): string { return `${hour % 12 || 12}:00 ${hour < 12 ? 'AM' : 'PM'}`; }
/** Whole percent of numerator/denominator, ties to even (matches the Python service's `:.0%`). */
export function percent(numerator: number, denominator: number): string {
  const scaled = numerator * 100;
  const whole = Math.floor(scaled / denominator);
  const twice = (scaled - whole * denominator) * 2;
  const rounded = twice > denominator || (twice === denominator && whole % 2 === 1) ? whole + 1 : whole;
  return `${rounded}%`;
}
function rateOrder(a: HourHistory, b: HourHistory): number { return a.successes * b.attempts - b.successes * a.attempts; }

/**
 * Returns candidates and whether any active activity has usable rule evidence.
 * Hour aggregates are user-wide, as supplied by Analytics. Frequency uses full
 * completions out of 14 daily opportunities. Partial 'done' logs are attempts.
 */
export function evaluate(activities: ActivityHistory[], hours: HourHistory[], logs: LogHistory[]): [Suggestion[], boolean] {
  const suggestions: Suggestion[] = [];
  let enoughData = false;
  const eligible = new Map<number, HourHistory>();
  for (const row of hours) if (row.attempts >= 3) eligible.set(row.hour, row);
  let best: HourHistory | undefined;
  for (const row of eligible.values()) {
    if (!best) { best = row; continue; }
    const order = rateOrder(row, best) || row.attempts - best.attempts || best.hour - row.hour;
    if (order > 0) best = row;
  }
  for (const activity of activities) {
    const currentHour = Number(activity.preferred_time.slice(0, 2));
    const current = eligible.get(currentHour);
    if (best && current) {
      enoughData = true;
      const gap = (best.successes * current.attempts - current.successes * best.attempts) * 100;
      if (best.hour !== currentHour && gap >= 15 * best.attempts * current.attempts) {
        suggestions.push({ activity, kind: 'timing', current_value: { preferred_time: activity.preferred_time },
          suggested_value: { preferred_time: `${String(best.hour).padStart(2, '0')}:00` },
          reason: `You complete ${activity.name} ${percent(best.successes, best.attempts)} of the time around ${displayHour(best.hour)} vs ${percent(current.successes, current.attempts)} around ${displayHour(currentHour)}`,
          confidence: confidence(Math.min(best.attempts, current.attempts)) });
      }
    }
    const activityLogs = logs.filter(log => log.activity_id === activity.id);
    if (activity.frequency !== 'daily' || activityLogs.length < 3) continue;
    enoughData = true;
    const completedCount = activityLogs.filter(log => log.status === 'completed').length;
    // Below 50% over 14 daily opportunities, the specified formula yields 3.
    const target = Math.max(3, Math.floor(completedCount / 2));
    if (completedCount < 7 && target < activity.target_per_week) {
      suggestions.push({ activity, kind: 'frequency', current_value: { target_per_week: activity.target_per_week }, suggested_value: { target_per_week: target },
        reason: `You completed ${activity.name} ${completedCount} of the last 14 daily targets (${percent(completedCount, 14)}). Try a target of ${target} per week.`,
        confidence: confidence(activityLogs.length) });
    }
  }
  return [suggestions, enoughData];
}
