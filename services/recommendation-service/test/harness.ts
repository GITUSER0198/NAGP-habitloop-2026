import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { createApp, getPool, signToken } from '@habitloop/shared';
import { initializeRecommendationTables } from '../src/db/init.js';
import { clock, registerRecommendationRoutes } from '../src/routes/recommendations.js';

export const PREFIX = '/api/recommendations';
export const NOW = new Date('2026-11-19T12:00:00Z');
export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test fixtures are free-form JSON
export type Seen = { method: string; url: URL; headers: Headers; body?: unknown };
export type Downstream = {
  activities: Json[]; hours: Json[]; logs: Json[]; requests: Seen[]; effects: [string, unknown][];
  patchStatus: number; historyStatus: number; transportError: boolean; eventError: boolean;
};

export type Harness = {
  app: FastifyInstance; identity: { tenant_id: string; user_id: string }; headers: Record<string, string>; downstream: Downstream;
  call: (method: InjectOptions['method'], path?: string, headers?: Record<string, string>) => ReturnType<FastifyInstance['inject']>;
  tokenFor: (identity: { tenant_id: string; user_id: string }) => Promise<Record<string, string>>;
  refresh: (headers?: Record<string, string>) => Promise<Json[]>;
  log: (status: string, daysAgo?: number) => Json;
  reset: () => Promise<void>;
  close: () => Promise<void>;
};

export function timing(state: Downstream): void {
  state.hours = [{ hour: '07', attempts: 11, successes: 9 }, { hour: '20', attempts: 10, successes: 4 }, { hour: '06', attempts: 2, successes: 2 }];
}

export async function createHarness(): Promise<Harness> {
  const app = await createApp('recommendation-service', PREFIX);
  await app.register(registerRecommendationRoutes, { prefix: PREFIX });
  await app.ready();
  await initializeRecommendationTables();
  const identity = { tenant_id: randomUUID(), user_id: randomUUID() };
  const tokenFor = async (who: { tenant_id: string; user_id: string }) =>
    ({ authorization: `Bearer ${await signToken({ sub: who.user_id, tenant_id: who.tenant_id, email: 'test@example.com', name: 'Tester' })}` });
  const downstream: Downstream = { activities: [], hours: [], logs: [], requests: [], effects: [], patchStatus: 200, historyStatus: 200, transportError: false, eventError: false };
  const harness: Harness = {
    app, identity, headers: await tokenFor(identity), downstream, tokenFor,
    call: (method, path = '', headers = harness.headers) => app.inject({ method, url: PREFIX + path, headers }),
    async refresh(headers = harness.headers) {
      const response = await harness.call('POST', '/refresh', headers);
      if (response.statusCode !== 200) throw new Error(`refresh returned ${response.statusCode}: ${response.body}`);
      return response.json().recommendations;
    },
    log(status, daysAgo = 1) {
      const activity = downstream.activities[0]!;
      return { tenant_id: activity.tenant_id, user_id: activity.user_id, activity_id: activity.id, status, logged_at: new Date(NOW.getTime() - daysAgo * 86400000).toISOString() };
    },
    async reset() {
      await getPool().query('DELETE FROM "recommendations_test"."recommendations"');
      Object.assign(downstream, { activities: [{ id: randomUUID(), ...identity, name: 'Running', active: true, frequency: 'daily', preferred_time: '20:30', target_per_week: 7 }],
        hours: [], logs: [], requests: [], effects: [], patchStatus: 200, historyStatus: 200, transportError: false, eventError: false });
      clock.now = () => NOW;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
        const url = new URL(String(input));
        const seen: Seen = { method: options?.method ?? 'GET', url, headers: new Headers(options?.headers), ...(options?.body ? { body: JSON.parse(String(options.body)) } : {}) };
        downstream.requests.push(seen);
        if (downstream.transportError) throw new TypeError('Service unavailable');
        if (seen.method === 'PATCH') {
          downstream.effects.push(['patch', seen.body]);
          if (downstream.patchStatus === 200) for (const activity of downstream.activities) if (url.pathname.includes(activity.id)) Object.assign(activity, seen.body);
          return Response.json({}, { status: downstream.patchStatus });
        }
        if (url.pathname === '/events') {
          if (downstream.eventError) throw new Error('Event bus unavailable');
          const message = seen.body as { source: string; 'detail-type': string; detail: unknown };
          downstream.effects.push([message['detail-type'], message.detail]);
          return new Response(null, { status: 202 });
        }
        const payload = url.pathname.endsWith('/hours') ? downstream.hours : url.pathname.endsWith('/logs') ? downstream.logs : url.pathname === '/api/activities' ? downstream.activities : undefined;
        if (payload === undefined) throw new Error(`Unexpected request: ${seen.method} ${url}`);
        return Response.json(payload, { status: downstream.historyStatus });
      });
    },
    close: async () => { vi.restoreAllMocks(); await app.close(); }
  };
  return harness;
}
