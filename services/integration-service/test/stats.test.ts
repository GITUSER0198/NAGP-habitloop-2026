import { describe, expect, it } from 'vitest';
import { wearableStats, type WearableLog } from '../src/stats.js';

describe('wearable stats', () => {
  const link = { id: 'watch', tenant_id: 'tenant', user_id: 'owner' };
  const now = new Date('2026-11-23T20:00:00Z');
  const event = (id: string, payload: Record<string, unknown>, status = 'received') => ({ id, payload,
    status, reason: status === 'rejected' ? 'Unmapped type' : null, received_at: now });
  const workout = { type: 'workout', started_at: '2026-11-23T19:00:00Z', provider_activity: 'walk', steps: 200, duration_min: 10, avg_heart_rate: 100 };
  it('uses local dates, cumulative snapshots, zero readings and excludes rejected data from totals', () => {
    const events = [event('walk', workout, 'normalized'), event('rejected', { ...workout, steps: 90000, avg_heart_rate: 200 }, 'rejected'),
      event('s1', { type: 'steps', started_at: workout.started_at, steps: 3000 }),
      event('s2', { type: 'steps', started_at: workout.started_at, steps: 4000 }),
      event('old', { ...workout, started_at: '2026-11-22T00:00:00Z' }),
      event('zero', { type: 'steps', started_at: '2026-11-22T19:00:00Z', steps: 0 })];
    const logs: WearableLog[] = [{ ...link, source: 'partner', source_event_id: 'walk', logged_at: workout.started_at,
      duration_min: 10, metadata: { link_id: 'watch' } }];
    const result = wearableStats(link, events, logs, 2, 'Asia/Kolkata', now);
    expect(result.today).toEqual({ date: '2026-11-24', steps: 4000, workouts: 1, active_minutes: 10 });
    expect(result.daily[0]).toEqual({ date: '2026-11-23', steps: 0, workouts: 0, active_minutes: 0 });
    expect(result.latest_heart_rate).toBe(100);
    expect(result.pipeline).toEqual({ received: 6, normalized: 1, rejected: 1 });
    expect(result.workouts.find(row => row.id === 'walk')?.status).toBe('Logged');
    expect(result.workouts.find(row => row.id === 'rejected')).toMatchObject({ status: 'Rejected', reason: 'Unmapped type' });
  });
  it('does not match foreign, manual or other-link logs and counts each workout only once', () => {
    const log: WearableLog = { tenant_id: 'tenant', user_id: 'owner', source: 'partner', source_event_id: 'a',
      logged_at: workout.started_at, duration_min: 10, metadata: { link_id: 'watch' } };
    const result = wearableStats(link, [event('a', workout)], [
      { ...log, tenant_id: 'other' }, { ...log, user_id: 'other' }, { ...log, source: 'manual' }, { ...log, metadata: { link_id: 'other' } }
    ], 7, 'UTC', now);
    expect(result.workouts[0]?.status).toBe('Pending');
    expect(result.today.workouts).toBe(1);
    expect(result.today.steps).toBe(200);
  });
  it('returns a filled calendar and honest missing values for no events', () => {
    const result = wearableStats(link, [], [], 7, 'UTC', now);
    expect(result.daily).toHaveLength(7);
    expect(result.today).toMatchObject({ steps: null, workouts: 0, active_minutes: 0 });
    expect(result.last_sync_at).toBeNull(); expect(result.latest_heart_rate).toBeNull();
    expect(result.workouts).toEqual([]);
  });
});
