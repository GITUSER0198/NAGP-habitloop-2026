import type { FastifyInstance, FastifyRequest } from 'fastify';

declare module 'fastify' { interface FastifyRequest { rawBody?: Buffer } }
export function registerRawBodyParser(app: FastifyInstance): void {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (request, body, done) => {
    const raw = Buffer.isBuffer(body) ? body : Buffer.from(body);
    (request as FastifyRequest).rawBody = raw;
    // Capability auth and link lookup precede JSON validation on ingestion.
    if (request.routeOptions.url?.endsWith('/ingest/:link_id')) return done(null, undefined);
    const text = raw.toString('utf8');
    if (text === '') return done(null, undefined);
    try { done(null, JSON.parse(text)); }
    catch { done(Object.assign(new Error('Invalid JSON'), { statusCode: 422, code: 'FST_ERR_CTP_INVALID_JSON_BODY' })); }
  });
}
