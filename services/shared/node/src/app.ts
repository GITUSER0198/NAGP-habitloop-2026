import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { getConfig } from './config.js';
import { initializeDatabase, closeDatabase } from './db.js';
import { createLogger } from './logger.js';

export async function createApp(name: string, prefix: string): Promise<FastifyInstance> {
  const cfg = getConfig();
  const logger: FastifyBaseLogger = createLogger(name);
  const app = Fastify({ loggerInstance: logger,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } }, genReqId: req => {
    const supplied = req.headers['x-request-id'];
    return typeof supplied === 'string' && supplied.length <= 128 ? supplied : crypto.randomUUID();
  } });
  app.setErrorHandler((error, request, reply) => {
    const serviceError = error as Error & { statusCode?: number; validation?: unknown };
    const statusCode = serviceError.validation ? 422 : (serviceError.statusCode ?? 500);
    if (statusCode >= 500) request.log.error({ err: error }, 'request_failed');
    return reply.code(statusCode).send({ detail: statusCode >= 500 ? 'Internal server error' : serviceError.message });
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
  app.get('/health', async () => ({ status: 'ok', service: name }));
  app.get(`${prefix}/health`, async () => ({ status: 'ok', service: name }));
  app.get(`${prefix}/openapi.json`, async (_request, reply) => reply.send(app.swagger()));
  app.addHook('onReady', async () => initializeDatabase());
  app.addHook('onClose', closeDatabase);
  return app;
}
