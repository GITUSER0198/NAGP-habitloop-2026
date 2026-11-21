// Shared public-API walkthrough for the PowerShell and POSIX launchers.
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped API payloads
type Row = Record<string, any>;

export class HttpError extends Error {
  constructor(readonly code: number) {
    super(`HTTP ${code}`);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function sign(key: string, body: string): string {
  return `sha256=${createHmac('sha256', key).update(body, 'utf-8').digest('hex')}`;
}

export class Walkthrough {
  readonly baseUrl: string;
  token = '';
  activity: Row = {};
  link: Row = {};
  recommendation: Row = {};
  readonly started = new Date();

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped API payloads
  async call(method: string, route: string, body?: unknown, headers: Record<string, string> = {}, expected = 200): Promise<any> {
    const requestHeaders: Record<string, string> = { 'Content-Type': 'application/json', ...headers };
    if (this.token) requestHeaders.Authorization = `Bearer ${this.token}`;
    const response = await fetch(this.baseUrl + route, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new HttpError(response.status);
    if (response.status !== expected) {
      throw new Error(`${method} ${route}: expected HTTP ${expected}, got ${response.status}`);
    }
    return response.json();
  }

  async waitFor(label: string, probe: () => Promise<boolean>): Promise<void> {
    const started = Date.now();
    for (;;) {
      if (await probe()) return;
      const elapsed = (Date.now() - started) / 1000;
      if (elapsed >= 90) throw new Error(`Timed out: ${label}`);
      console.log(`  ${label}: elapsed ${elapsed.toFixed(0)}s of 90s`);
      await sleep(2000);
    }
  }

  async register(): Promise<void> {
    const suffix = randomUUID().replaceAll('-', '');
    const result = await this.call('POST', '/api/users/register', {
      email: `smoke-${suffix}@example.com`, password: randomBytes(24).toString('base64url'),
      name: 'Smoke Walker', tenant_name: `Smoke ${suffix}`, timezone: 'UTC',
    }, {}, 201);
    this.token = result.token;
    check((await this.call('GET', '/api/users/me')).id === result.user.id, 'Profile does not match the new user');
  }

  async createActivity(): Promise<void> {
    this.activity = await this.call('POST', '/api/activities', {
      name: 'Walkthrough run', category: 'fitness', frequency: 'daily',
      preferred_time: '20:00', target_per_week: 7,
    }, {}, 201);
  }

  async logStatuses(): Promise<void> {
    const route = `/api/activities/${this.activity.id}/logs`;
    for (let index = 0; index < 6; index += 1) {
      for (const [hour, status] of [[7, 'completed'], [20, 'missed']] as const) {
        const day = new Date(this.started.getTime() - (index + 1) * 86_400_000);
        day.setUTCMinutes(0, 0, 0);
        day.setUTCHours(hour);
        const result = await this.call('POST', route, { status, logged_at: day.toISOString() }, {}, 201);
        check(result.status === status, `Log status ${result.status} is not ${status}`);
      }
    }
    check((await this.call('POST', route, { status: 'done' }, {}, 201)).status === 'done', 'Default log is not done');
    check((await this.call('GET', route)).length === 13, 'Expected 13 logs');
  }

  async analytics(): Promise<void> {
    await this.waitFor('waiting for 13 analytics logs', async () => {
      const rows: Row[] = await this.call('GET', '/api/analytics/trend?days=7');
      const total = rows.reduce((sum, row) => sum + row.done + row.missed + row.completed, 0);
      return total === 13;
    });
    const summary = await this.call('GET', '/api/analytics/summary');
    check(summary.rate_7d > 0 && summary.rate_7d < 1, 'rate_7d is not between 0 and 1');
    check((await this.call('GET', '/api/analytics/heatmap')).length === 365, 'Heatmap does not have 365 rows');
    check('overall' in (await this.call('GET', '/api/analytics/milestones')), 'Milestones have no overall entry');
  }

  async linkIntegration(): Promise<void> {
    this.link = await this.call('POST', '/api/integrations/links', {
      provider: 'mockfit', activity_map: { run: this.activity.id },
    }, {}, 201);
    check(this.link.ingest_key, 'The link has no ingest key');
  }

  async simulate(): Promise<void> {
    const eventId = randomUUID().replaceAll('-', '');
    const body = JSON.stringify({
      event_id: eventId, type: 'workout', provider_activity: 'run',
      started_at: this.started.toISOString(), duration_min: 30, steps: 6000,
    });
    const route = `/api/integrations/ingest/${this.link.id}`;
    const headers = { 'X-HabitLoop-Signature': sign(this.link.ingest_key, body) };
    await this.call('POST', route, body, headers, 202);
    check((await this.call('POST', route, body, headers)).duplicate === true, 'Replay was not reported as duplicate');
    let rejected = false;
    try {
      await this.call('POST', route, body, { 'X-HabitLoop-Signature': 'sha256=invalid' });
    } catch (error) {
      if (!(error instanceof HttpError) || error.code !== 401) throw error;
      rejected = true;
    }
    if (!rejected) throw new Error('Invalid partner signature was accepted');

    await this.waitFor('waiting for normalized partner event', async () => {
      const events: Row[] = await this.call('GET', `/api/integrations/links/${this.link.id}/events`);
      return events.some((row) => row.event_id === eventId && row.status === 'normalized');
    });
    const logs: Row[] = await this.call('GET', `/api/activities/${this.activity.id}/logs`);
    check(logs.length === 14, 'Expected 14 logs after the partner event');
    check(logs.filter((row) => row.source === 'partner').length === 1, 'Expected exactly one partner log');
  }

  async refresh(): Promise<void> {
    await this.waitFor('waiting for timing recommendation', async () => {
      const result = await this.call('POST', '/api/recommendations/refresh');
      this.recommendation = (result.recommendations as Row[]).find((row) => row.kind === 'timing') ?? {};
      return Object.keys(this.recommendation).length > 0;
    });
    check(this.recommendation.suggested_value.preferred_time === '07:00', 'Suggested time is not 07:00');
    const listed: Row = await this.call('GET', '/api/recommendations');
    check((listed.recommendations as Row[]).some((row) => row.id === this.recommendation.id), 'Recommendation is not listed');
  }

  async accept(): Promise<void> {
    const route = `/api/recommendations/${this.recommendation.id}/accept`;
    check((await this.call('POST', route)).status === 'accepted', 'First accept did not return accepted');
    check((await this.call('POST', route)).status === 'accepted', 'Second accept did not return accepted');
    const activity = await this.call('GET', `/api/activities/${this.activity.id}`);
    check(activity.preferred_time === '07:00', 'Activity time was not changed to 07:00');
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { 'base-url': { type: 'string', default: process.env.BASE_URL ?? 'http://localhost:47810' } },
  });
  const walkthrough = new Walkthrough(values['base-url'] as string);
  const steps: Array<[string, () => Promise<void>]> = [
    ['register', () => walkthrough.register()],
    ['create activity', () => walkthrough.createActivity()],
    ['log done/missed/completed', () => walkthrough.logStatuses()],
    ['read analytics', () => walkthrough.analytics()],
    ['link integration', () => walkthrough.linkIntegration()],
    ['simulate signed event and replay', () => walkthrough.simulate()],
    ['refresh recommendation', () => walkthrough.refresh()],
    ['accept recommendation', () => walkthrough.accept()],
  ];
  for (const [index, [label, action]] of steps.entries()) {
    console.log(`${index + 1} of ${steps.length}: ${label}`);
    try {
      await action();
    } catch (error) {
      const reason = error instanceof HttpError ? `HTTP ${error.code}`
        : error instanceof Error ? error.message || error.name : String(error);
      console.error(`FAIL: ${label}: ${reason}`);
      return 1;
    }
    console.log(`PASS: ${label}`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
