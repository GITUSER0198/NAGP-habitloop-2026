export interface WearableLog {
  tenant_id: string; user_id: string; source: string; source_event_id: string | null;
  logged_at: string; duration_min: number | null; metadata: Record<string, unknown>;
}
interface Link { id: string; tenant_id: string; user_id: string }
interface Event {
  id: string; payload: unknown; status: string; reason: string | null; received_at: Date;
}

export function wearableStats(link: Link, events: Event[], logs: WearableLog[], days: number, timezone: string, now: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const date = (value: string | Date) => formatter.format(new Date(value));
  const today = date(now);
  const anchor = new Date(`${today}T12:00:00Z`);
  const daily = Array.from({ length: days }, (_, index) => {
    const day = new Date(anchor); day.setUTCDate(day.getUTCDate() - days + index + 1);
    return { date: day.toISOString().slice(0, 10), steps: null as number | null, workouts: 0, active_minutes: 0 };
  });
  const ownedLogs = logs.filter(log => log.tenant_id === link.tenant_id && log.user_id === link.user_id &&
    log.source === 'partner' && log.metadata.link_id === link.id);
  const logged = new Map(ownedLogs.map(log => [log.source_event_id, log]));
  const pipeline = { received: events.length, normalized: 0, rejected: 0 };
  const workouts: { id: string; type: string; started_at: string; duration_min: number | null; steps: number | null;
    avg_heart_rate: number | null; status: string; reason: string | null }[] = [];
  let latest: { at: string; value: number } | null = null;
  const snapshots = new Map<string, number>();
  const workoutSteps = new Map<string, number>();
  const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
  for (const event of events) {
    if (event.status === 'normalized') pipeline.normalized++;
    if (event.status === 'rejected') pipeline.rejected++;
    const payload = event.payload as Record<string, unknown>;
    if (typeof payload.started_at !== 'string' || !Number.isFinite(Date.parse(payload.started_at))) continue;
    const day = daily.find(item => item.date === date(payload.started_at as string));
    if (!day) continue;
    const log = logged.get(event.id);
    const steps = number(payload.steps) ?? number(log?.metadata.steps);
    const hr = number(payload.avg_heart_rate) ?? number(log?.metadata.avg_heart_rate);
    if (event.status !== 'rejected' && hr !== null && (!latest || Date.parse(payload.started_at) > Date.parse(latest.at))) latest = { at: payload.started_at, value: hr };
    if (event.status !== 'rejected' && payload.type === 'steps' && steps !== null) snapshots.set(day.date, Math.max(snapshots.get(day.date) ?? 0, steps));
    if (payload.type !== 'workout') continue;
    const duration = number(payload.duration_min) ?? log?.duration_min ?? null;
    workouts.push({ id: event.id, type: String(payload.provider_activity), started_at: payload.started_at,
      duration_min: duration, steps, avg_heart_rate: hr,
      status: event.status === 'rejected' ? 'Rejected' : log ? 'Logged' : 'Pending', reason: event.reason });
    if (event.status !== 'rejected') {
      day.workouts++;
      day.active_minutes += duration ?? 0;
      if (steps !== null) workoutSteps.set(day.date, (workoutSteps.get(day.date) ?? 0) + steps);
    }
  }
  // Daily step readings are cumulative, and already include workout steps.
  for (const day of daily) day.steps = snapshots.get(day.date) ?? workoutSteps.get(day.date) ?? null;
  workouts.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at) || a.id.localeCompare(b.id));
  return { timezone, daily, today: daily[daily.length - 1]!, workouts, latest_heart_rate: latest?.value ?? null,
    last_sync_at: events[0]?.received_at.toISOString() ?? null, pipeline };
}
