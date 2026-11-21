import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseOptions, run, sign, UsageError } from '../src/simulate.js';

const LINK = '123e4567-e89b-12d3-a456-426614174000';
let server: Server | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  return new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

describe('parseOptions', () => {
  it('applies the defaults', () => {
    const options = parseOptions(['--link-id', LINK, '--key', 'k'], {});
    expect(options).toMatchObject({ count: 1, replay: false, providerActivity: 'run', gatewayUrl: 'http://localhost:47810' });
  });
  it('honours GATEWAY_PORT and flags', () => {
    const options = parseOptions(['--link-id', LINK, '--key', 'k', '--count', '3', '--replay'], { GATEWAY_PORT: '47999' });
    expect(options).toMatchObject({ count: 3, replay: true, gatewayUrl: 'http://localhost:47999' });
  });
  it('rejects a missing key, a bad link id and a count below 1', () => {
    expect(() => parseOptions(['--link-id', LINK], {})).toThrow(UsageError);
    expect(() => parseOptions(['--link-id', 'nope', '--key', 'k'], {})).toThrow('invalid UUID');
    expect(() => parseOptions(['--link-id', LINK, '--key', 'k', '--count', '0'], {})).toThrow('at least 1');
  });
});

describe('run', () => {
  async function gateway(): Promise<{ url: string; signatures: string[] }> {
    const seen = new Set<string>();
    const signatures: string[] = [];
    server = createServer((request, response) => {
      let text = '';
      request.on('data', (chunk) => { text += chunk; });
      request.on('end', () => {
        signatures.push(String(request.headers['x-habitloop-signature']));
        const id = (JSON.parse(text) as { event_id: string }).event_id;
        const duplicate = seen.has(id);
        seen.add(id);
        response.writeHead(duplicate ? 200 : 202, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(duplicate ? { duplicate: true } : { accepted: true }));
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, signatures };
  }

  it('sends each event once and replays the same body when asked', async () => {
    const { url, signatures } = await gateway();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await run({ linkId: LINK, key: 'secret', count: 2, replay: true, providerActivity: 'run', gatewayUrl: url });
    expect(code).toBe(0);
    expect(signatures).toHaveLength(4);
    expect(signatures[0]).toBe(signatures[1]);
    expect(String(log.mock.calls.at(-1)?.[0])).toMatch(/^Finished: 2 accepted, 2 duplicate/);
  });

  it('fails without printing the key when the gateway rejects', async () => {
    server = createServer((_request, response) => { response.writeHead(401).end('{}'); });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await run({ linkId: LINK, key: 'top-secret', count: 1, replay: false, providerActivity: 'run', gatewayUrl: url });
    expect(code).toBe(1);
    expect(String(error.mock.calls[0]?.[0])).toBe('Failed after 0 of 1 requests: HTTP 401');
  });
});

describe('sign', () => {
  it('matches the documented sha256 HMAC form', () => {
    expect(sign('key', 'body')).toBe('sha256=515aae133b435d4000956731f68ae5cf5eb85d4f0dc6a546d2bfcd3595ec1ae1');
  });
});
