import Fastify, { type FastifyBaseLogger } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { requireInternal } from '@habitloop/shared/auth';
import { createLogger } from '@habitloop/shared/logger';
import { handler as normalizePartner } from '@habitloop/event-normalizer';
import { handler as updateAnalytics } from '@habitloop/analytics-updater';

export type EventHandler = (detail: Record<string, unknown>) => Promise<unknown>;
const handlers: Record<string, EventHandler[]> = {
  PartnerEventReceived: [async detail => normalizePartner(detail)],
  ActivityLogged: [async detail => updateAnalytics(detail)],
  ActivityLogDeleted: [async detail => updateAnalytics({ 'detail-type': 'ActivityLogDeleted', detail })]
};

function validateEvent(body: unknown): Array<Record<string, unknown>> {
  const error = (type: string, loc: string[], msg: string, input: unknown, ctx?: Record<string, unknown>) =>
    ({ type, loc, msg, input, ...(ctx ? { ctx } : {}) });
  if (body === undefined) return [error('missing', ['body'], 'Field required', null)];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return [error('model_attributes_type', ['body'], 'Input should be a valid dictionary or object to extract fields from', body)];
  }
  const event = body as Record<string, unknown>;
  const errors: Array<Record<string, unknown>> = [];
  const typeField = Object.hasOwn(event, 'detail-type') ? 'detail-type' : Object.hasOwn(event, 'detail_type') ? 'detail_type' : 'detail-type';
  for (const field of [typeField, 'detail', 'source']) {
    const input = event[field];
    const loc = ['body', field];
    if (!Object.hasOwn(event, field)) {
      if (field !== 'source') errors.push(error('missing', loc, 'Field required', body));
    } else if (field === 'detail') {
      if (!input || typeof input !== 'object' || Array.isArray(input)) errors.push(error('dict_type', loc, 'Input should be a valid dictionary', input));
    } else if (field === 'source' && input === null) continue;
    else if (typeof input !== 'string') errors.push(error('string_type', loc, 'Input should be a valid string', input));
    else if (field !== 'source' && !input.length) errors.push(error('string_too_short', loc, 'String should have at least 1 character', input, { min_length: 1 }));
  }
  return errors;
}

export async function createWorker(registeredHandlers: Record<string, EventHandler[]> = handlers) {
  const logger: FastifyBaseLogger = createLogger('event-worker');
  const app = Fastify({ loggerInstance: logger });
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    if (body.length === 0) return done(null, undefined);
    try { done(null, JSON.parse(body.toString()) as unknown); }
    catch (error) {
      const message = (error as Error).message;
      const text = body.toString();
      const token = /^Unexpected token '(.)'/.exec(message)?.[1];
      const position = Number(/position (\d+)/.exec(message)?.[1] ?? (token ? text.lastIndexOf(token) : text.length));
      const reason = /property name|double-quoted/.test(message) ? 'Expecting property name enclosed in double quotes' :
        /Expected ':'/.test(message) ? "Expecting ':' delimiter" : /Expected ','/.test(message) ? "Expecting ',' delimiter" :
          /non-whitespace/.test(message) ? 'Extra data' : 'Expecting value';
      done(Object.assign(new Error('Invalid JSON'), { code: 'FST_ERR_CTP_INVALID_JSON_BODY', position, reason }), undefined);
    }
  });
  app.setErrorHandler((error, request, reply) => {
    const failure = error as Error & { code?: string; position?: number; reason?: string };
    if (failure.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      return reply.code(422).send({ detail: [{ type: 'json_invalid', loc: ['body', failure.position], msg: 'JSON decode error', input: {}, ctx: { error: failure.reason } }] });
    }
    request.log.error({ event: 'event_dispatch_failed' }, 'event_dispatch_failed');
    return reply.code(500).type('text/plain').send('Internal Server Error');
  });
  await app.register(swagger, { openapi: { info: { title: 'HabitLoop event worker', version: '1.0.0' } } });
  await app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list' }, staticCSP: true });
  app.addHook('onRequest', async (request, reply) => {
    const supplied = request.headers['x-request-id'];
    const requestId = typeof supplied === 'string' && supplied.length <= 128 ? supplied : crypto.randomUUID();
    request.log = request.log.child({ request_id: requestId });
    reply.header('X-Request-ID', requestId);
  });
  app.get('/health', async () => ({ status: 'ok', service: 'event-worker' }));
  app.post('/events', { preHandler: requireInternal }, async (request, reply) => {
    const errors = validateEvent(request.body);
    if (errors.length) return reply.code(422).send({ detail: errors });
    const event = request.body as Record<string, unknown>;
    const detailType = (Object.hasOwn(event, 'detail-type') ? event['detail-type'] : event.detail_type) as string;
    const detail = event.detail as Record<string, unknown>;
    const selected = Object.hasOwn(registeredHandlers, detailType) ? registeredHandlers[detailType] : [];
    if (typeof detail.tenant_id === 'string') request.log = request.log.child({ tenant_id: detail.tenant_id });
    request.log.info({ event: 'event_received', detail_type: detailType, handler_count: selected.length }, 'event_received');
    for (const handler of selected) await handler(detail);
    return reply.code(202).send({ status: 'accepted' });
  });
  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const app = await createWorker();
  const port = Number(process.env.SERVICE_PORT ?? 47820);
  await app.listen({ host: '0.0.0.0', port });
}
