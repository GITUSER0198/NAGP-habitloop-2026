import type { RequestHandler } from './$types';
import { apiResponse, pageError } from '$lib/server/api';

export const GET: RequestHandler = async (event) => {
  const abort = new AbortController();
  const handshake = setTimeout(() => abort.abort(), 10000);
  event.request.signal.addEventListener('abort', () => abort.abort(), { once: true });
  try {
    const upstream = await apiResponse(event, '/api/analytics/stream', { signal: abort.signal });
    clearTimeout(handshake);
    if (!upstream.body) throw new Error('Empty event stream');
    const reader = upstream.body.getReader();
    const expiry = setTimeout(() => abort.abort(), Math.max(0, event.locals.expiresAt - Date.now()));
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { value, done } = await reader.read();
          if (done) { clearTimeout(expiry); controller.close(); }
          else controller.enqueue(value);
        } catch (cause) { clearTimeout(expiry); controller.error(cause); }
      },
      async cancel() { clearTimeout(expiry); abort.abort(); await reader.cancel().catch(() => {}); }
    });
    return new Response(body, { headers: {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store', 'X-Accel-Buffering': 'no'
    } });
  } catch (cause) { clearTimeout(handshake); abort.abort(); pageError(cause); }
};
