import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpError, sign, Walkthrough } from '../src/smoke.js';

let server: Server | undefined;
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

async function serve(handler: (request: IncomingMessage) => { status: number; body: unknown }): Promise<string> {
  server = createServer((request, response) => {
    const { status, body } = handler(request);
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('sign', () => {
  it('produces the documented sha256 HMAC header value', () => {
    expect(sign('key', 'body')).toBe('sha256=515aae133b435d4000956731f68ae5cf5eb85d4f0dc6a546d2bfcd3595ec1ae1');
  });
});

describe('Walkthrough.call', () => {
  it('sends the bearer token and returns the JSON body', async () => {
    let seen = '';
    const base = await serve((request) => {
      seen = String(request.headers.authorization);
      return { status: 200, body: { ok: true } };
    });
    const walkthrough = new Walkthrough(`${base}/`);
    walkthrough.token = 'abc';
    expect(await walkthrough.call('GET', '/x')).toEqual({ ok: true });
    expect(seen).toBe('Bearer abc');
  });

  it('turns an error status into an HttpError', async () => {
    const base = await serve(() => ({ status: 401, body: {} }));
    await expect(new Walkthrough(base).call('GET', '/x')).rejects.toMatchObject({ code: 401 });
    await expect(new Walkthrough(base).call('GET', '/x')).rejects.toBeInstanceOf(HttpError);
  });

  it('rejects an unexpected success status', async () => {
    const base = await serve(() => ({ status: 200, body: {} }));
    await expect(new Walkthrough(base).call('POST', '/x', {}, {}, 201)).rejects.toThrow('expected HTTP 201, got 200');
  });
});
