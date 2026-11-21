// Send signed mock workouts and optionally replay the exact same bodies.
import { createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const UUID_PATTERN = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export class HttpError extends Error {
  constructor(readonly code: number) {
    super(`HTTP ${code}`);
  }
}

/** The gateway answered with an unexpected (but successful) status or body. */
class ReplyError extends Error {}

/** Thrown for bad command-line input; the process exits with code 2 like a usage error. */
export class UsageError extends Error {}

export interface Options {
  linkId: string;
  key: string;
  count: number;
  replay: boolean;
  providerActivity: string;
  gatewayUrl: string;
}

export function parseOptions(argv: string[], env: NodeJS.ProcessEnv = process.env): Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      'link-id': { type: 'string' },
      key: { type: 'string' },
      count: { type: 'string', default: '1' },
      replay: { type: 'boolean', default: false },
      'provider-activity': { type: 'string', default: 'run' },
      'gateway-url': { type: 'string', default: `http://localhost:${env.GATEWAY_PORT ?? '47810'}` },
    },
  });
  if (!values['link-id']) throw new UsageError('the following arguments are required: --link-id');
  if (!UUID_PATTERN.test(values['link-id'])) throw new UsageError(`argument --link-id: invalid UUID value: '${values['link-id']}'`);
  if (!values.key) throw new UsageError('the following arguments are required: --key');
  const count = Number(values.count);
  if (!Number.isInteger(count)) throw new UsageError(`argument --count: invalid int value: '${values.count}'`);
  if (count < 1) throw new UsageError('argument --count: count must be at least 1');
  return {
    linkId: values['link-id'],
    key: values.key,
    count,
    replay: values.replay as boolean,
    providerActivity: values['provider-activity'] as string,
    gatewayUrl: values['gateway-url'] as string,
  };
}

export function sign(key: string, body: string): string {
  return `sha256=${createHmac('sha256', key).update(body, 'utf-8').digest('hex')}`;
}

export async function send(
  baseUrl: string, linkId: string, key: string, body: string,
): Promise<{ status: number; result: { duplicate?: boolean } }> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/integrations/ingest/${linkId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-HabitLoop-Signature': sign(key, body) },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new HttpError(response.status);
  return { status: response.status, result: (await response.json()) as { duplicate?: boolean } };
}

export async function run(options: Options): Promise<number> {
  const total = options.count * (options.replay ? 2 : 1);
  let sent = 0;
  let accepted = 0;
  let duplicates = 0;
  const started = Date.now();
  try {
    for (let index = 0; index < options.count; index += 1) {
      const body = JSON.stringify({
        event_id: randomUUID(), type: 'workout', started_at: new Date().toISOString(),
        duration_min: index % 2 === 0 ? 25 : 10, steps: index % 3 === 0 ? 5500 : 1500,
        provider_activity: options.providerActivity,
      });
      for (let replay = 0; replay < (options.replay ? 2 : 1); replay += 1) {
        const { status, result } = await send(options.gatewayUrl, options.linkId, options.key, body);
        const duplicate = result.duplicate === true;
        if (replay > 0 && (status !== 200 || !duplicate)) throw new ReplyError('Replay did not return HTTP 200 duplicate');
        if (replay === 0 && (status !== 202 || duplicate)) throw new ReplyError('New event did not return HTTP 202');
        if (duplicate) duplicates += 1; else accepted += 1;
        sent += 1;
        console.log(`${sent} of ${total}: ${duplicate ? 'replay duplicate' : 'accepted'} (HTTP ${status})`);
      }
    }
  } catch (error) {
    // Never print the key or signed request headers.
    const reason = error instanceof HttpError ? `HTTP ${error.code}`
      : error instanceof ReplyError ? error.message
        : error instanceof Error ? error.name : 'Error';
    console.error(`Failed after ${sent} of ${total} requests: ${reason}`);
    return 1;
  }
  console.log(`Finished: ${accepted} accepted, ${duplicates} duplicate; elapsed ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return 0;
}

async function main(): Promise<number> {
  let options: Options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(`usage: simulate --link-id <uuid> --key <key> [--count N] [--replay] [--provider-activity run] [--gateway-url URL]`);
    console.error(`simulate: error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  return run(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
