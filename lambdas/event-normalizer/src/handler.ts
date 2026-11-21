import { SignJWT } from 'jose';
import { eventTimestamp, eventUuid } from '@habitloop/shared/event-input';

type JsonObject = Record<string, unknown>;
type Detail = JsonObject & {
  tenant_id: string; user_id: string; link_id: string; partner_event_id: string;
  provider?: string; raw?: unknown;
};
type EventEnvelope = { 'detail-type'?: string; detail?: unknown } & JsonObject;
type FailureResponse = { batchItemFailures: Array<{ itemIdentifier: string }> };

const env = (name: string): string => {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} must be set and nonempty`);
  return value;
};

async function serviceHeaders(detail: Detail): Promise<Record<string, string>> {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ tenant_id: detail.tenant_id, email: 'partner@habitloop.internal', name: 'Partner normalizer' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setSubject(detail.user_id)
    .setIssuedAt(now).setExpirationTime(now + 3600).sign(new TextEncoder().encode(env('JWT_SECRET')));
  return { Authorization: `Bearer ${token}`, 'X-Internal-Token': env('INTERNAL_TOKEN'), 'content-type': 'application/json' };
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
}

async function mark(detail: Detail, headers: Record<string, string>, status: string, reason?: string): Promise<void> {
  const body: JsonObject = { status };
  if (reason !== undefined) body.reason = reason;
  const base = env('INTEGRATION_SERVICE_URL').replace(/\/+$/, '');
  const response = await request(`${base}/api/integrations/internal/events/${detail.partner_event_id}`, {
    method: 'PATCH', headers, body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Integration status update failed (HTTP ${response.status})`);
}

function workout(raw: unknown): JsonObject {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Workout must be an object');
  const value = raw as JsonObject;
  if (value.type !== 'workout') throw new Error('Unsupported partner event type');
  for (const key of ['event_id', 'provider_activity']) {
    const field = value[key];
    if (typeof field !== 'string' || !field.trim() || Array.from(field).length > 255) throw new Error(`Invalid ${key}`);
  }
  if (!Number.isInteger(value.duration_min) || (value.duration_min as number) < 0) throw new Error('duration_min must be a nonnegative integer');
  if (value.steps !== undefined && value.steps !== null && (!Number.isInteger(value.steps) || (value.steps as number) < 0)) throw new Error('steps must be a nonnegative integer');
  eventTimestamp(value.started_at, 'started_at must be an ISO timestamp with timezone', 'started_at must include a timezone');
  return value;
}

function identity(detail: unknown): Detail {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) throw new Error('Event detail must be an object');
  const result = { ...detail } as JsonObject;
  for (const field of ['tenant_id', 'user_id', 'link_id', 'partner_event_id']) {
    result[field] = eventUuid(result[field], field);
  }
  return result as Detail;
}

export async function normalize(untrusted: unknown): Promise<void> {
  const detail = identity(untrusted);
  const headers = await serviceHeaders(detail);
  let raw: JsonObject;
  try {
    if (detail.provider !== 'mockfit' && detail.provider !== 'mockrun') throw new Error('Unsupported provider');
    raw = workout(detail.raw);
  } catch (error) {
    await mark(detail, headers, 'rejected', error instanceof Error ? error.message : 'Invalid workout');
    return;
  }
  const integrationBase = env('INTEGRATION_SERVICE_URL').replace(/\/+$/, '');
  const linksResponse = await request(`${integrationBase}/api/integrations/links`, { headers });
  if (!linksResponse.ok) throw new Error(`Integration links request failed (HTTP ${linksResponse.status})`);
  const links: unknown = await linksResponse.json();
  if (!Array.isArray(links)) throw new Error('Expected a list of integration links');
  const link = links.find((entry): entry is JsonObject => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid integration link');
    return (entry as JsonObject).id === detail.link_id;
  });
  if (!link || link.status !== 'active') { await mark(detail, headers, 'rejected', 'Link is no longer active'); return; }
  if (['tenant_id', 'user_id', 'provider'].some((field) => link[field] !== detail[field])) {
    await mark(detail, headers, 'rejected', 'Partner event does not match link identity'); return;
  }
  const map = link.activity_map;
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('Invalid activity map');
  let activity = Object.hasOwn(map, raw.provider_activity as string) ? (map as JsonObject)[raw.provider_activity as string] : undefined;
  if (activity === undefined || activity === null) { await mark(detail, headers, 'rejected', `Unmapped provider activity: ${raw.provider_activity}`); return; }
  try { activity = eventUuid(activity, 'activity_id'); }
  catch { await mark(detail, headers, 'rejected', 'Mapped activity ID is invalid'); return; }
  const status = (raw.duration_min as number) >= 20 || ((raw.steps as number | null | undefined) ?? 0) >= 5000 ? 'completed' : 'done';
  const activityBase = env('ACTIVITY_SERVICE_URL').replace(/\/+$/, '');
  const response = await request(`${activityBase}/api/activities/internal/logs`, {
    method: 'POST', headers,
    body: JSON.stringify({
      tenant_id: detail.tenant_id, user_id: detail.user_id, activity_id: activity, status,
      logged_at: raw.started_at, duration_min: raw.duration_min, source: 'partner',
      source_event_id: detail.partner_event_id,
      metadata: { provider: detail.provider, link_id: detail.link_id, event_id: raw.event_id, steps: raw.steps ?? null }
    })
  });
  if ([404, 409, 422].includes(response.status)) { await mark(detail, headers, 'rejected', `Activity log rejected (HTTP ${response.status})`); return; }
  if (!response.ok) throw new Error(`Activity log request failed (HTTP ${response.status})`);
  await mark(detail, headers, 'normalized');
}

function detailOf(event: unknown, expectedType: string): unknown {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Expected an event object');
  const value = event as EventEnvelope;
  if ('detail-type' in value) {
    if (value['detail-type'] !== expectedType) throw new Error(`Expected ${expectedType}`);
    return value.detail;
  }
  return event;
}

export async function handler(event: JsonObject): Promise<FailureResponse> {
  if (!('Records' in event)) { await normalize(detailOf(event, 'PartnerEventReceived')); return { batchItemFailures: [] }; }
  if (!Array.isArray(event.Records)) throw new Error('Records must be an array');
  const batchItemFailures: FailureResponse['batchItemFailures'] = [];
  for (const entry of event.Records) {
    const record = entry as { messageId?: unknown; body?: unknown };
    try {
      if (typeof record.messageId !== 'string' || typeof record.body !== 'string') throw new Error('Malformed SQS record');
      await normalize(detailOf(JSON.parse(record.body) as unknown, 'PartnerEventReceived'));
    } catch {
      if (typeof record.messageId === 'string') batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}

export const __test = { workout, detailOf };
