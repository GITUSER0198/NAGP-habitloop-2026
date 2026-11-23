export interface WearableStats {
  timezone: string;
  daily: { date: string; steps: number | null; workouts: number; active_minutes: number }[];
  today: { date: string; steps: number | null; workouts: number; active_minutes: number };
  workouts: { id: string; type: string; started_at: string; duration_min: number | null; steps: number | null;
    avg_heart_rate: number | null; status: string; reason: string | null }[];
  latest_heart_rate: number | null; last_sync_at: string | null;
  pipeline: { received: number; normalized: number; rejected: number };
}
