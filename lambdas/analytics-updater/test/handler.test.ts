import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aggregate, handler, queryAllPages, setAnalyticsStoreForTests, type AnalyticsStore } from '../src/handler.js';
import { jwtVerify } from 'jose';

const id = { tenant: '11111111-1111-4111-8111-111111111111', user: '22222222-2222-4222-8222-222222222222',
  activity: '33333333-3333-4333-8333-333333333333', log: '44444444-4444-4444-8444-444444444444',
  challenge: '55555555-5555-4555-8555-555555555555', challenge2: '66666666-6666-4666-8666-666666666666' };
const event = (overrides: Record<string, unknown> = {}) => ({ tenant_id: id.tenant, user_id: id.user, activity_id: id.activity,
  log_id: id.log, status: 'done', logged_at: '2026-11-19T07:30:00Z', challenge_ids: [], ...overrides });
class MemoryStore implements AnalyticsStore {
  readonly rows = new Map<string, Record<string, unknown>>();
  attempts = 0;
  failOnce?: (mutations: Array<{ item: Record<string, unknown>; condition?: unknown }>, store: MemoryStore) => void;
  private key(pk: string, sk: string): string { return `${pk}\n${sk}`; }
  async get(pk: string, sk: string) { const item = this.rows.get(this.key(pk, sk)); return item ? { ...item, PK: pk, SK: sk } : undefined; }
  async query(pk: string, prefix: string) { return [...this.rows.values()].filter(item => item.PK === pk && String(item.SK).startsWith(prefix)).map(item => ({ ...item, PK: pk, SK: String(item.SK) })); }
  async transact(mutations: Parameters<AnalyticsStore['transact']>[0]) {
    this.attempts++;
    if (this.failOnce) { const fail = this.failOnce; this.failOnce = undefined; fail(mutations, this); }
    for (const { item, condition } of mutations) {
      const old = this.rows.get(this.key(String(item.PK), String(item.SK)));
      if (condition === 'absent' && old) throw Object.assign(new Error('duplicate'), { name: 'TransactionCanceledException' });
      if (condition && condition !== 'absent' && Number(old?.revision ?? 0) !== condition.revision) throw Object.assign(new Error('revision conflict'), { name: 'TransactionCanceledException' });
    }
    for (const { item, add, set, ifAbsent } of mutations) {
      const key = this.key(String(item.PK), String(item.SK));
      const row = add || set || ifAbsent ? { ...this.rows.get(key), ...item } : { ...item };
      for (const [name, value] of Object.entries(add ?? {})) row[name] = Number(row[name] ?? 0) + value;
      Object.assign(row, set);
      for (const [name, value] of Object.entries(ifAbsent ?? {})) if (!Object.hasOwn(row, name)) row[name] = value;
      this.rows.set(key, row);
    }
  }
}
let db: MemoryStore;
let fetchMock: ReturnType<typeof vi.fn>;
const pk = () => `TENANT#${id.tenant}#USER#${id.user}`;
const get = (sk: string, partition = pk()) => db.rows.get(`${partition}\n${sk}`);
beforeEach(() => {
  process.env.DYNAMODB_TABLE = 'habitloop-analytics'; process.env.AWS_REGION = 'ap-south-1';
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret'; process.env.INTERNAL_TOKEN = 'internal'; process.env.CHALLENGE_SERVICE_URL = 'http://challenge:47820';
  db = new MemoryStore(); setAnalyticsStoreForTests(db);
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ target_count: 10 }), { status: 200 })); vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { setAnalyticsStoreForTests(undefined); vi.unstubAllGlobals(); });

describe('analytics updater parity', () => {
  it.each(['ValidationError', 'ProvisionedThroughputExceeded', 'ItemCollectionSizeLimitExceeded'])('does not retry terminal transaction cancellation %s', async Code => {
    db.failOnce = () => { throw Object.assign(new Error(Code), { name: 'TransactionCanceledException', CancellationReasons: [{ Code }] }); };
    await expect(aggregate(event())).rejects.toThrow(Code);
    expect(db.attempts).toBe(1); expect(get(`SEEN#${id.log}`)).toBeUndefined();
  });

  it('retries transaction conflicts only up to the Python limit', async () => {
    const fail = () => {
      db.failOnce = fail;
      throw Object.assign(new Error('conflict'), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'TransactionConflict' }] });
    };
    db.failOnce = fail;
    await expect(aggregate(event())).rejects.toThrow('conflict');
    expect(db.attempts).toBe(8); expect(get('DAY#2026-11-19')).toBeUndefined();
  });

  it('writes the exact Python keys and attributes in one transaction', async () => {
    await aggregate(event({ challenge_ids: [id.challenge], logged_at: '2026-11-19T13:00:00.123456+05:30' }));
    expect(db.attempts).toBe(1);
    const row = (SK: string, attributes: Record<string, unknown>, PK = pk()) => ({ PK, SK, ...attributes });
    expect([...db.rows.values()].sort((a, b) => String(a.SK).localeCompare(String(b.SK)))).toEqual([
      row(`SEEN#${id.log}`, { logged_at: '2026-11-19T07:30:00.123456+00:00' }),
      row('DAY#2026-11-19', { date: '2026-11-19', done: 1 }),
      row('STREAK', { current: 1, best: 1, last_date: '2026-11-19', revision: 1 }),
      row(`ACTIVITY#${id.activity}#DAY#2026-11-19`, { date: '2026-11-19', done: 1 }),
      row(`ACTIVITY#${id.activity}#STREAK`, { current: 1, best: 1, last_date: '2026-11-19' }),
      row('HOUR#07', { attempts: 1, successes: 1 }),
      row('COHORT#2026-11-16', { week: '2026-11-16', done: 1, attempts: 1, successes: 1 }),
      row(`PROGRESS#${id.challenge}`, { count: 1, target: 10 }),
      row(`PROGRESS#${id.user}`, { user_id: id.user, count: 1, target: 10 }, `TENANT#${id.tenant}#CHALLENGE#${id.challenge}`)
    ].sort((a, b) => a.SK.localeCompare(b.SK)));
  });

  it('rejects null envelope detail instead of aggregating envelope identity', async () => {
    await expect(handler({ ...event(), detail: null })).rejects.toThrow('Event detail must be an object');
    expect(db.attempts).toBe(0);
  });

  it.each(['2026-02-30T07:00:00Z', '2026-11-19T24:00:00Z', '2026-11-19T07:00:00'])('rejects invalid calendar timestamp %s before writing', async logged_at => {
    await expect(aggregate(event({ logged_at }))).rejects.toThrow(); expect(db.attempts).toBe(0);
  });

  it('rejects an oversized transaction before writing a marker or aggregates', async () => {
    await expect(aggregate(event({ challenge_ids: Array.from({ length: 47 }, () => crypto.randomUUID()) }))).rejects.toThrow('transaction capacity');
    expect(db.attempts).toBe(0); expect(db.rows.size).toBe(0);
  });

  it('preserves atomic increments and first badge date rather than replacing counters', async () => {
    const realTransact = db.transact.bind(db);
    db.transact = async mutations => {
      db.rows.set(`${pk()}\nHOUR#07`, { PK: pk(), SK: 'HOUR#07', attempts: 3, successes: 2, retained: 'value' });
      await realTransact(mutations);
    };
    await aggregate(event());
    expect(get('HOUR#07')).toEqual({ PK: pk(), SK: 'HOUR#07', attempts: 4, successes: 3, retained: 'value' });
  });
  it('counts duplicate log once across all user and activity metrics, partitioned by tenant', async () => {
    await handler({ 'detail-type': 'ActivityLogged', detail: event() }); await aggregate(event());
    expect(get('DAY#2026-11-19')?.done).toBe(1); expect(get('STREAK')?.current).toBe(1); expect(get('STREAK')?.revision).toBe(1);
    expect(get('HOUR#07')?.attempts).toBe(1); expect(get('HOUR#07')?.successes).toBe(1);
    expect(get('COHORT#2026-11-16')?.done).toBe(1); expect(get(`SEEN#${id.log}`)).toBeDefined();
    expect(get(`ACTIVITY#${id.activity}#DAY#2026-11-19`)?.done).toBe(1);
    const otherTenant = '77777777-7777-4777-8777-777777777777';
    await aggregate(event({ tenant_id: otherTenant }));
    expect(db.rows.has(`TENANT#${otherTenant}#USER#${id.user}\nDAY#2026-11-19`)).toBe(true);
    expect(db.rows.get(`${pk()}\nDAY#2026-11-19`)?.done).toBe(1);
  });

  it('recomputes streaks for gaps, late arrivals, missed and completed logs', async () => {
    for (const [day, status] of [[17, 'done'], [19, 'completed'], [18, 'done'], [19, 'done']] as const) await aggregate(event({ log_id: crypto.randomUUID(), status, logged_at: `2026-11-${day}T07:00:00Z` }));
    expect(get('STREAK')?.current).toBe(3); expect(get('STREAK')?.best).toBe(3);
    await aggregate(event({ log_id: crypto.randomUUID(), status: 'missed', logged_at: '2026-11-18T08:00:00Z' }));
    expect(get('STREAK')?.current).toBe(1); expect(get('STREAK')?.best).toBe(3);
    await aggregate(event({ log_id: crypto.randomUUID(), status: 'missed', logged_at: '2026-11-19T08:00:00Z' }));
    expect(get('STREAK')?.current).toBe(0);
    await aggregate(event({ log_id: crypto.randomUUID(), status: 'completed', logged_at: '2026-11-19T09:00:00Z' }));
    expect(get('STREAK')?.current).toBe(0);
  });

  it('normalizes day, hour and cohort to UTC calendar boundaries', async () => {
    await aggregate(event({ logged_at: '2026-11-16T01:00:00+05:30' }));
    expect(get('DAY#2026-11-15')?.done).toBe(1); expect(get('HOUR#19')?.successes).toBe(1);
    expect(get('COHORT#2026-11-09')?.attempts).toBe(1);
  });

  it.each([7, 30, 100])('earns badge %s once for user and activity history and retains it', async threshold => {
    const day = '2026-11-19';
    for (let offset = 1; offset < threshold; offset++) {
      const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - offset);
      const dateText = date.toISOString().slice(0, 10);
      for (const prefix of ['', `ACTIVITY#${id.activity}#`]) db.rows.set(`${pk()}\n${prefix}DAY#${dateText}`, { PK: pk(), SK: `${prefix}DAY#${dateText}`, date: dateText, done: 1 });
    }
    await aggregate(event());
    expect(get(`BADGE#${threshold}`)?.earned_date).toBe(day);
    expect(get(`ACTIVITY#${id.activity}#BADGE#${threshold}`)?.earned_date).toBe(day);
    await aggregate(event({ log_id: crypto.randomUUID(), status: 'missed' }));
    expect(get(`BADGE#${threshold}`)?.earned_date).toBe(day); expect(get('STREAK')?.current).toBe(0);
    expect(get('STREAK')?.best).toBe(threshold);
  });

  it('leaves no marker after transaction failure and succeeds on retry', async () => {
    db.failOnce = () => { throw Object.assign(new Error('retry'), { name: 'InternalServerError' }); };
    await expect(aggregate(event())).rejects.toThrow('retry');
    expect(get(`SEEN#${id.log}`)).toBeUndefined(); expect(get('DAY#2026-11-19')).toBeUndefined();
    await aggregate(event()); expect(get('DAY#2026-11-19')?.done).toBe(1);
  });

  it('reloads streak history after a concurrent revision conflict', async () => {
    db.failOnce = (_mutations, store) => {
      store.rows.set(`${pk()}\nSTREAK`, { PK: pk(), SK: 'STREAK', revision: 1, current: 1, best: 1, last_date: '2026-11-18' });
      store.rows.set(`${pk()}\nDAY#2026-11-18`, { PK: pk(), SK: 'DAY#2026-11-18', date: '2026-11-18', done: 1 });
      throw Object.assign(new Error('conflict'), { name: 'TransactionCanceledException' });
    };
    await aggregate(event());
    expect(db.attempts).toBe(2); expect(get('STREAK')?.revision).toBe(2); expect(get('STREAK')?.current).toBe(2);
  });

  it('deduplicates challenge IDs, authenticates challenge reads, and updates both progress partitions', async () => {
    await aggregate(event({ challenge_ids: [id.challenge, id.challenge2, id.challenge] }));
    await aggregate(event());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['X-Internal-Token']).toBe('internal');
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([`${process.env.CHALLENGE_SERVICE_URL}/api/challenges/${id.challenge}`, `${process.env.CHALLENGE_SERVICE_URL}/api/challenges/${id.challenge2}`]);
    const { payload } = await jwtVerify(headers.Authorization.slice(7), new TextEncoder().encode(process.env.JWT_SECRET));
    expect(payload).toMatchObject({ sub: id.user, tenant_id: id.tenant, email: 'analytics@habitloop.internal', name: 'Analytics updater' });
    expect(Number(payload.exp) - Number(payload.iat)).toBe(3600);
    await aggregate(event({ log_id: crypto.randomUUID(), status: 'missed', challenge_ids: [id.challenge, id.challenge2] }));
    for (const challengeId of [id.challenge, id.challenge2]) {
      expect(get(`PROGRESS#${challengeId}`)?.count).toBe(1);
      expect(get(`PROGRESS#${challengeId}`)?.target).toBe(10);
      const boardPk = `TENANT#${id.tenant}#CHALLENGE#${challengeId}`;
      expect(get(`PROGRESS#${id.user}`, boardPk)?.count).toBe(1);
      expect(get(`PROGRESS#${id.user}`, boardPk)?.target).toBe(10);
    }
  });

  it('returns only failed SQS message ids, continues, and accepts empty batches', async () => {
    const records = [{ messageId: 'ok', body: JSON.stringify({ detail: event() }) }, { messageId: 'bad-json', body: '{' },
      { messageId: 'bad-status', body: JSON.stringify(event({ status: 'bad' })) }, { messageId: 'retry', body: JSON.stringify(event()) }];
    await expect(handler({ Records: records })).resolves.toEqual({ batchItemFailures: [
      { itemIdentifier: 'bad-json' }, { itemIdentifier: 'bad-status' }
    ] });
    expect(get('DAY#2026-11-19')?.done).toBe(1);
    await expect(handler({ Records: [] })).resolves.toEqual({ batchItemFailures: [] });
  });

  it('reads every query page and passes the cursor through unchanged', async () => {
    const cursor = { PK: 'p', SK: 's' }; const calls: Array<Record<string, unknown> | undefined> = [];
    const rows = await queryAllPages(async current => { calls.push(current); return calls.length === 1 ? { items: [{ PK: 'p', SK: 'DAY#1' }], cursor } : { items: [{ PK: 'p', SK: 'DAY#2' }] }; });
    expect(rows).toHaveLength(2); expect(calls).toEqual([undefined, cursor]);
  });

  it('rejects invalid status and timezone inputs as batch failures', async () => {
    await expect(aggregate(event({ status: 'bad' }))).rejects.toThrow('Unknown activity status');
    await expect(aggregate(event({ logged_at: '2026-11-19T07:30:00' }))).rejects.toThrow('timezone');
    await expect(handler({ Records: [{ messageId: 'bad', body: JSON.stringify(event({ status: 'bad' })) }] }))
      .resolves.toEqual({ batchItemFailures: [{ itemIdentifier: 'bad' }] });
  });
});
