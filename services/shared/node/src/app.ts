import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { getConfig } from './config.js';
import { initializeDatabase, closeDatabase } from './db.js';
import { createLogger } from './logger.js';

export function invalidInput(message: string, input: unknown, loc: (string | number)[] = ['body']): never {
  throw Object.assign(new Error(message), { statusCode: 422, detail: [{ type: 'value_error', loc, msg: message, input }] });
}

export async function createApp(name: string, prefix: string): Promise<FastifyInstance> {
  const cfg = getConfig();
  const logger: FastifyBaseLogger = createLogger(name);
  const app = Fastify({ loggerInstance: logger,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } }, genReqId: req => {
    const supplied = req.headers['x-request-id'];
    return typeof supplied === 'string' && supplied.length <= 128 ? supplied : crypto.randomUUID();
  } });
  const parseJson = app.getDefaultJsonParser('error', 'error');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const text = body.toString();
    if (text === '') return done(null, undefined);
    parseJson(request, text, done);
  });
  app.setErrorHandler((error, request, reply) => {
    const serviceError = error as Error & { code?: string; statusCode?: number; detail?: unknown; validationContext?: string; validation?: { instancePath: string; keyword: string; message?: string; params: Record<string, unknown> }[] };
    const invalidJson = serviceError.code === 'FST_ERR_CTP_INVALID_JSON_BODY';
    const statusCode = serviceError.validation || invalidJson ? 422 : (serviceError.statusCode ?? 500);
    if (statusCode >= 500) request.log.error({ err: error }, 'request_failed');
    const detail = serviceError.validation?.map(item => {
      const context = serviceError.validationContext ?? 'body';
      const path = item.instancePath.split('/').slice(1).map(value => value.replace(/~1/g, '/').replace(/~0/g, '~'));
      const field = item.params.missingProperty ?? item.params.additionalProperty;
      if (typeof field === 'string') path.push(field);
      const source = context === 'body' ? request.body : context === 'params' ? request.params : request.query;
      const input = path.reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, source);
      return { type: item.keyword, loc: [context === 'params' ? 'path' : context === 'querystring' ? 'query' : context, ...path.map(value => /^\d+$/.test(value) ? Number(value) : value)], msg: item.message ?? 'Invalid input', input: input ?? null };
    }) ?? serviceError.detail ?? (invalidJson ? [{ type: 'json_invalid', loc: ['body'], msg: 'JSON decode error', input: null }] : statusCode >= 500 && !serviceError.statusCode ? 'Internal server error' : serviceError.message);
    return reply.code(statusCode).send({ detail });
  });
  app.addHook('onRequest', async (request, reply) => {
    request.log = request.log.child({ request_id: request.id });
    reply.header('X-Request-ID', request.id);
  });
  app.addHook('onResponse', async (request, reply) => {
    request.log.info({ event: 'request_completed', method: request.method, path: request.url, status: reply.statusCode }, 'request_completed');
  });
  await app.register(cors, { origin: cfg.webPort ? [`http://localhost:${cfg.webPort}`, `http://127.0.0.1:${cfg.webPort}`] : false,
    credentials: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'], exposedHeaders: ['X-Request-ID'] });
  await app.register(swagger, { openapi: { info: { title: `HabitLoop ${name}`, version: '1.0.0' }, servers: [{ url: '/' }] } });
  await app.register(swaggerUi, { routePrefix: `${prefix}/docs`, uiConfig: { docExpansion: 'list' }, staticCSP: true });
  await app.register(async docs => { await docs.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list' }, staticCSP: true }); });
  app.get('/health', { schema: { hide: true } }, async () => ({ status: 'ok', service: name }));
  app.get(`${prefix}/health`, async () => ({ status: 'ok', service: name }));
  app.get(`${prefix}/openapi.json`, { schema: { hide: true } }, async (_request, reply) => reply.send(app.swagger()));
  app.addHook('onReady', async () => initializeDatabase());
  app.addHook('onClose', closeDatabase);
  return app;
}
