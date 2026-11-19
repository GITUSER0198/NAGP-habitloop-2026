import { formatTime } from '$lib/time';

export interface Challenge {
  id: string; owner_id: string; title: string; description: string; visibility: string;
  activity_category: string; start_date: string; end_date: string; target_count: number;
}
export interface Provider { provider: string; activity_types: string[] }
export interface PartnerLink {
  id: string; provider: string; activity_map: Record<string, string>; created_at: string;
}
export interface PartnerEvent {
  id: string; event_id: string; link_id: string; status: string; reason: string | null; received_at: string;
}
export interface LinkSecret { id: string; ingest_key: string; providerActivity: string }
export interface Recommendation {
  id: string; activity_id: string; kind: string; current_value: Record<string, string | number>;
  suggested_value: Record<string, string | number>; reason: string;
  confidence: 'low' | 'medium' | 'high'; status: string; created_at: string;
}
export interface RecommendationList { recommendations: Recommendation[]; reason?: string }
export interface ChallengeProgress {
  leaderboard: { user_id: string; name: string; count: number; target: number }[];
}
export function schedule(value: Record<string, string | number>): string {
  return Object.entries(value).map(([key, item]) => key === 'preferred_time'
    ? formatTime(String(item)) : key === 'target_per_week' ? `${item} times per week` : String(item)).join(', ');
}
export function cardValue(row: Recommendation, suggested: boolean): string {
  const value = suggested ? row.suggested_value : row.current_value;
  return row.kind === 'timing' ? String(value.preferred_time ?? '') : schedule(value);
}
export function submitAction(id: string): void {
  const form = document.getElementById(id);
  if (form instanceof HTMLFormElement) form.requestSubmit();
}
