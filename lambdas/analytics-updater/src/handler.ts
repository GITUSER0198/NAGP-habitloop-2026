import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { SignJWT } from 'jose';
import { eventTimestamp, eventUuid } from '@habitloop/shared/event-input';

type Item = Record<string, unknown> & { PK: string; SK: string };
type Detail = { tenant_id: string; user_id: string; activity_id: string; log_id: string; status: string; logged_at: string; challenge_ids?: string[] };
type Mutation = { item: Item; condition?: 'absent' | { revision: number }; add?: Record<string, number>; set?: Record<string, unknown>; ifAbsent?: Record<string, unknown> };
export interface AnalyticsStore {
  get(pk: string, sk: string): Promise<Item | undefined>;
  query(pk: string, prefix: string): Promise<Item[]>;
  transact(mutations: Mutation[]): Promise<void>;
}
export async function queryAllPages(fetchPage: (cursor?: Record<string, unknown>) => Promise<{ items: Item[]; cursor?: Record<string, unknown> }>): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return items;
}
const statuses = ['done', 'completed', 'missed'] as const;
const tableName = (): string => process.env.DYNAMODB_TABLE || 'habitloop-analytics';
const env = (name: string): string => { const value = process.env[name]; if (!value?.trim()) throw new Error(`${name} must be set and nonempty`); return value; };

export class AwsStore implements AnalyticsStore {
  private readonly client: DynamoDBDocumentClient;
  constructor() {
    this.client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-south-1', requestHandler: { connectionTimeout: 2000, requestTimeout: 2000 }, ...(process.env.DYNAMODB_ENDPOINT ? { endpoint: process.env.DYNAMODB_ENDPOINT } : {}) }),
      { marshallOptions: { removeUndefinedValues: true } });
  }
  async get(pk: string, sk: string): Promise<Item | undefined> {
    const result = await this.client.send(new GetCommand({ TableName: tableName(), Key: { PK: pk, SK: sk }, ConsistentRead: true }));
    return result.Item as Item | undefined;
  }
  async query(pk: string, prefix: string): Promise<Item[]> {
    return queryAllPages(async (cursor) => {
      const result = await this.client.send(new QueryCommand({ TableName: tableName(), ConsistentRead: true,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': pk, ':prefix': prefix }, ExclusiveStartKey: cursor }));
      return { items: result.Items as Item[] ?? [], cursor: result.LastEvaluatedKey };
    });
  }
  async transact(mutations: Mutation[]): Promise<void> {
    await this.client.send(new TransactWriteCommand({ TransactItems: mutations.map(({ item, condition, add, set, ifAbsent }) => {
      if (add || set || ifAbsent) {
        const names: Record<string, string> = {};
        const values: Record<string, unknown> = {};
        const terms = (attributes: Record<string, unknown>, mode: 'add' | 'set' | 'absent'): string[] => Object.entries(attributes).map(([name, value]) => {
          const index = Object.keys(names).length;
          names[`#n${index}`] = name; values[`:v${index}`] = value;
          return mode === 'add' ? `#n${index} :v${index}` : `#n${index} = ${mode === 'absent' ? `if_not_exists(#n${index}, :v${index})` : `:v${index}`}`;
        });
        const increments = terms(add ?? {}, 'add');
        const setters = [...terms(set ?? {}, 'set'), ...terms(ifAbsent ?? {}, 'absent')];
        return { Update: { TableName: tableName(), Key: item,
          UpdateExpression: [increments.length ? `ADD ${increments.join(', ')}` : '', setters.length ? `SET ${setters.join(', ')}` : ''].filter(Boolean).join(' '),
          ExpressionAttributeNames: names, ExpressionAttributeValues: values } };
      }
      return { Put: {
      TableName: tableName(), Item: item,
      ...(condition === 'absent' ? { ConditionExpression: 'attribute_not_exists(PK)' } : {}),
      ...(typeof condition === 'object' ? { ConditionExpression: 'attribute_not_exists(revision) OR revision = :revision', ExpressionAttributeValues: { ':revision': condition.revision } } : {})
    } };
    }) }));
  }
}

let injectedStore: AnalyticsStore | undefined;
function store(): AnalyticsStore { return injectedStore ?? new AwsStore(); }
export function setAnalyticsStoreForTests(value?: AnalyticsStore): void { injectedStore = value; }

function normalizedUuid(value: unknown, name: string): string {
  return eventUuid(value, name);
}
function userPk(tenantId: string, userId: string): string { return `TENANT#${tenantId}#USER#${userId}`; }
function challengePk(tenantId: string, challengeId: string): string { return `TENANT#${tenantId}#CHALLENGE#${challengeId}`; }
function dateString(date: Date): string { return date.toISOString().slice(0, 10); }
function streaks(days: Item[]): { current: number; best: number; last_date: string | null; earned: Map<number, string> } {
  let current = 0; let best = 0; let previous: string | undefined;
  const earned = new Map<number, string>();
  for (const item of [...days].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    const day = String(item.date);
    const d = new Date(`${day}T00:00:00.000Z`);
    if (previous && d.getTime() - new Date(`${previous}T00:00:00.000Z`).getTime() !== 86_400_000) current = 0;
    if (Number(item.missed ?? 0) || !(Number(item.done ?? 0) + Number(item.completed ?? 0))) current = 0;
    else current++;
    best = Math.max(best, current);
    for (const threshold of [7, 30, 100]) if (current >= threshold && !earned.has(threshold)) earned.set(threshold, day);
    previous = day;
  }
  return { current, best, last_date: previous ?? null, earned };
}
function monday(date: Date): string { const d = new Date(date); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return dateString(d); }

async function challengeTargets(detail: Detail, ids: string[]): Promise<Map<string, number>> {
  const targets = new Map<string, number>();
  if (!ids.length) return targets;
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ tenant_id: detail.tenant_id, email: 'analytics@habitloop.internal', name: 'Analytics updater' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setSubject(detail.user_id).setIssuedAt(now).setExpirationTime(now + 3600)
    .sign(new TextEncoder().encode(env('JWT_SECRET')));
  for (const id of ids) {
    const base = env('CHALLENGE_SERVICE_URL').replace(/\/+$/, '');
    const response = await fetch(`${base}/api/challenges/${id}`, { headers: { Authorization: `Bearer ${token}`, 'X-Internal-Token': env('INTERNAL_TOKEN') }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`Challenge lookup failed (HTTP ${response.status})`);
    const body = await response.json() as { target_count?: unknown };
    if (!Number.isInteger(body.target_count) || (body.target_count as number) < 0) throw new Error('Invalid challenge target_count');
    targets.set(id, body.target_count as number);
  }
  return targets;
}

export async function aggregate(input: unknown): Promise<void> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Event detail must be an object');
  const detail = input as Detail;
  const tenantId = normalizedUuid(detail.tenant_id, 'tenant_id');
  const userId = normalizedUuid(detail.user_id, 'user_id');
  const activityId = normalizedUuid(detail.activity_id, 'activity_id');
  const logId = normalizedUuid(detail.log_id, 'log_id');
  if (!(statuses as readonly string[]).includes(detail.status)) throw new Error('Unknown activity status');
  const timestamp = eventTimestamp(detail.logged_at, 'Invalid logged_at timestamp', 'logged_at requires a timezone');
  const logged = timestamp.date;
  const day = dateString(logged);
  const week = monday(logged);
  if (detail.challenge_ids !== undefined && (!Array.isArray(detail.challenge_ids) || detail.challenge_ids.some((id) => typeof id !== 'string'))) throw new Error('challenge_ids must be an array of UUIDs');
  const ids = [...new Set((detail.challenge_ids ?? []).map((id) => normalizedUuid(id, 'challenge_id')))].sort();
  const pk = userPk(tenantId, userId);
  const seenKey = `SEEN#${logId}`;
  const db = store();
  if (await db.get(pk, seenKey)) return;
  const targets = await challengeTargets({ ...detail, tenant_id: tenantId, user_id: userId }, ids);

  for (let attempt = 0; attempt < 8; attempt++) {
    const old = await db.get(pk, 'STREAK') ?? { PK: pk, SK: 'STREAK' };
    const revision = Number(old.revision ?? 0);
    const mutations: Mutation[] = [{ item: { PK: pk, SK: seenKey, logged_at: timestamp.iso }, condition: 'absent' }];
    for (const prefix of ['', `ACTIVITY#${activityId}#`]) {
      const days = await db.query(pk, `${prefix}DAY#`);
      const existing = days.find((entry) => entry.date === day) ?? { PK: pk, SK: `${prefix}DAY#${day}`, date: day };
      const updatedDay = { ...existing, [detail.status]: Number(existing[detail.status] ?? 0) + 1 } as Item;
      const history = days.filter((entry) => entry.date !== day).concat(updatedDay);
      const calculated = streaks(history);
      const previous: Item = prefix ? (await db.get(pk, `${prefix}STREAK`) ?? { PK: pk, SK: `${prefix}STREAK` }) : old;
      const streakItem: Item = { PK: pk, SK: `${prefix}STREAK`, current: calculated.current,
        best: Math.max(calculated.best, Number(previous.best ?? 0)), last_date: calculated.last_date };
      if (!prefix) streakItem.revision = revision + 1;
      mutations.push({ item: { PK: pk, SK: `${prefix}DAY#${day}` }, add: { [detail.status]: 1 }, set: { date: day } },
        { item: streakItem, ...(!prefix ? { condition: { revision } } : {}) });
      for (const [threshold, earnedDate] of calculated.earned) {
        const badgeSk = `${prefix}BADGE#${threshold}`;
        mutations.push({ item: { PK: pk, SK: badgeSk }, set: { days: threshold }, ifAbsent: { earned_date: earnedDate } });
      }
    }
    const success = detail.status === 'missed' ? 0 : 1;
    const hour = String(logged.getUTCHours()).padStart(2, '0');
    const hourKey = `HOUR#${hour}`;
    mutations.push({ item: { PK: pk, SK: hourKey }, add: { attempts: 1, successes: success } });
    const cohortKey = `COHORT#${week}`;
    mutations.push({ item: { PK: pk, SK: cohortKey }, add: { [detail.status]: 1, attempts: 1, successes: success }, set: { week } });
    for (const id of ids) {
      const progressKey = `PROGRESS#${id}`;
      mutations.push({ item: { PK: pk, SK: progressKey }, add: { count: success }, set: { target: targets.get(id) } });
      const boardPk = challengePk(tenantId, id);
      mutations.push({ item: { PK: boardPk, SK: `PROGRESS#${userId}` }, add: { count: success }, set: { user_id: userId, target: targets.get(id) } });
    }
    if (mutations.length > 100) throw new Error('Activity event exceeds DynamoDB transaction capacity');
    try { await db.transact(mutations); return; }
    catch (error) {
      const failure = error as { name?: string; CancellationReasons?: Array<{ Code?: string }> };
      if (failure.name !== 'TransactionCanceledException') throw error;
      if (await db.get(pk, seenKey)) return;
      if (failure.CancellationReasons?.some(reason => !['None', 'ConditionalCheckFailed', 'TransactionConflict'].includes(reason.Code ?? ''))) throw error;
      if (attempt === 7) throw error;
      await new Promise((resolve) => setTimeout(resolve, (10 + Math.random() * 20) * (attempt + 1)));
    }
  }
}

function eventDetail(event: unknown): unknown {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Expected an event object');
  const value = event as { detail?: unknown };
  return Object.hasOwn(value, 'detail') ? value.detail : event;
}
export async function handler(event: Record<string, unknown>): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> {
  if (!('Records' in event)) { await aggregate(eventDetail(event)); return { batchItemFailures: [] }; }
  if (!Array.isArray(event.Records)) throw new Error('Records must be an array');
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const entry of event.Records) {
    const record = entry as { messageId?: unknown; body?: unknown };
    try {
      if (typeof record.body !== 'string' || typeof record.messageId !== 'string') throw new Error('Malformed SQS record');
      await aggregate(eventDetail(JSON.parse(record.body) as unknown));
    } catch {
      if (typeof record.messageId === 'string') batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}

export const __test = { userPk, challengePk, streaks, monday, normalizedUuid };
