import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { getConfig } from './config.js';

export type UserClaims = { userId: string; tenantId: string; email?: string; name?: string };
declare module 'fastify' {
  interface FastifyRequest { user?: UserClaims }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function signToken(claims: { sub: string; tenant_id: string; email: string; name: string }): Promise<string> {
  const cfg = getConfig();
  return new SignJWT({ tenant_id: claims.tenant_id, email: claims.email, name: claims.name })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(claims.sub).setIssuedAt().setExpirationTime('60m')
    .sign(cfg.jwtSecret);
}

export async function verifyToken(token: string): Promise<Record<string, unknown>> {
  const { payload } = await jwtVerify(token, getConfig().jwtSecret, { algorithms: ['HS256'] });
  if (typeof payload.sub !== 'string' || !uuid.test(payload.sub) ||
      typeof payload.tenant_id !== 'string' || !uuid.test(payload.tenant_id) ||
      typeof payload.email !== 'string' || !payload.email.trim() ||
      typeof payload.name !== 'string' || !payload.name.trim() ||
      typeof payload.iat !== 'number' || payload.iat > Math.floor(Date.now() / 1000) ||
      typeof payload.exp !== 'number') throw new Error('Invalid identity claims');
  return payload as Record<string, unknown>;
}

function reject(request: FastifyRequest, reply: FastifyReply, kind = 'bearer'): void {
  request.log.warn({ event: 'auth_failed', auth_kind: kind }, 'auth_failed');
  void reply.code(401).header('WWW-Authenticate', kind === 'bearer' ? 'Bearer' : '').send({
    detail: kind === 'bearer' ? 'Invalid or missing bearer token' : 'Invalid or missing internal token'
  });
}

export const requireUser: preHandlerHookHandler = async (request, reply) => {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return reject(request, reply);
  try {
    const claims = await verifyToken(header.slice(7));
    request.user = { userId: claims.sub as string, tenantId: claims.tenant_id as string,
      email: claims.email as string, name: claims.name as string };
    request.log = request.log.child({ tenant_id: request.user.tenantId });
  } catch { return reject(request, reply); }
};

export const requireInternal: preHandlerHookHandler = async (request, reply) => {
  const actual = request.headers['x-internal-token'];
  const expected = getConfig().internalToken;
  const a = Buffer.from(typeof actual === 'string' ? actual : '');
  const b = Buffer.from(expected);
  const equal = timingSafeEqual(a.length === b.length ? a : Buffer.alloc(b.length), b) && a.length === b.length;
  if (!equal)
    return reject(request, reply, 'internal');
};
