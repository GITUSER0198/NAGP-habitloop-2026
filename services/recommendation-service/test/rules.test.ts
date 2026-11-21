import { describe, expect, it } from 'vitest';
import { confidence, displayHour, evaluate, percent, type ActivityHistory, type LogHistory } from '../src/rules.js';

const activity = (changes: Partial<ActivityHistory> = {}): ActivityHistory => ({ id: 'a1', tenant_id: 't', user_id: 'u', name: 'Running', frequency: 'daily', preferred_time: '20:30', target_per_week: 7, active: true, ...changes });
const log = (status: LogHistory['status'], activityId = 'a1'): LogHistory => ({ tenant_id: 't', user_id: 'u', activity_id: activityId, status, logged_at: new Date('2026-11-18T12:00:00Z') });

describe('rule helpers', () => {
  it.each([[2, 'low'], [9, 'low'], [10, 'medium'], [29, 'medium'], [30, 'high'], [500, 'high']])('confidence(%i) is %s', (attempts, expected) => expect(confidence(attempts)).toBe(expected));
  it.each([[0, '12:00 AM'], [7, '7:00 AM'], [11, '11:00 AM'], [12, '12:00 PM'], [13, '1:00 PM'], [20, '8:00 PM'], [23, '11:00 PM']])('displayHour(%i) is %s', (hour, expected) => expect(displayHour(hour)).toBe(expected));
  it.each([[9, 11, '82%'], [4, 10, '40%'], [1, 8, '12%'], [3, 8, '38%'], [5, 8, '62%'], [1, 3, '33%'], [2, 3, '67%'], [0, 5, '0%'], [5, 5, '100%']])('percent(%i, %i) is %s with ties to even', (n, d, expected) => expect(percent(n, d)).toBe(expected));
});

describe('evaluate', () => {
  it('returns nothing and no evidence for no activities', () => expect(evaluate([], [{ hour: 7, attempts: 5, successes: 5 }], [])).toEqual([[], false]));
  it('ignores hours with fewer than three attempts (the lone eligible hour is its own best)', () => expect(evaluate([activity()], [{ hour: 7, attempts: 2, successes: 2 }, { hour: 20, attempts: 3, successes: 0 }], [])).toEqual([[], true]));
  it('suggests the best window with exact rational comparison', () => {
    const [found, enough] = evaluate([activity()], [{ hour: 7, attempts: 20, successes: 13 }, { hour: 20, attempts: 20, successes: 10 }], []);
    expect(enough).toBe(true);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'timing', suggested_value: { preferred_time: '07:00' }, confidence: 'medium' });
  });
  it('counts a timing gap of exactly 15 points as enough, and 14 as not', () => {
    expect(evaluate([activity()], [{ hour: 7, attempts: 100, successes: 55 }, { hour: 20, attempts: 100, successes: 40 }], [])[0]).toHaveLength(1);
    expect(evaluate([activity()], [{ hour: 7, attempts: 100, successes: 54 }, { hour: 20, attempts: 100, successes: 40 }], [])[0]).toHaveLength(0);
  });
  it('suggests each active activity independently', () => {
    const [found] = evaluate([activity(), activity({ id: 'a2', name: 'Reading', preferred_time: '07:00' })], [{ hour: 7, attempts: 10, successes: 10 }, { hour: 20, attempts: 10, successes: 2 }], []);
    expect(found.map(item => item.activity.name)).toEqual(['Running']);
  });
  it('never suggests a frequency change for weekly or custom activities', () => {
    for (const frequency of ['weekly', 'custom'] as const) expect(evaluate([activity({ frequency })], [], [log('missed'), log('missed'), log('missed')])).toEqual([[], false]);
  });
  it('treats partial done logs as attempts, not completions', () => {
    const [found, enough] = evaluate([activity()], [], [log('done'), log('done'), log('done'), log('done')]);
    expect(enough).toBe(true);
    expect(found[0]!.reason).toContain('0 of the last 14 daily targets (0%)');
    expect(found[0]!.confidence).toBe('low');
  });
  it('does not suggest a frequency when completion reaches 7 of 14', () => {
    const logs = [...Array(7).fill(0).map(() => log('completed')), log('missed'), log('missed')];
    expect(evaluate([activity()], [], logs)).toEqual([[], true]);
  });
  it('ignores logs for other activities', () => expect(evaluate([activity()], [], [log('missed', 'a2'), log('missed', 'a2'), log('missed', 'a2')])).toEqual([[], false]));
});
