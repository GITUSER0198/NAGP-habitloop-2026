import { env } from '$env/dynamic/private';
import { error, json, redirect, type Handle } from '@sveltejs/kit';
import { jwtVerify } from 'jose';
import { COOKIE } from '$lib/server/api';
import { disabledRoute } from '$lib/config/features';

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.user = null;
  event.locals.expiresAt = 0;
  const token = event.cookies.get(COOKIE);
  if (disabledRoute(event.url.pathname)) error(404, 'Not found');
  if (token && env.JWT_SECRET) {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET), { algorithms: ['HS256'] });
      if (!payload.sub || typeof payload.tenant_id !== 'string' || typeof payload.email !== 'string'
        || typeof payload.name !== 'string' || typeof payload.exp !== 'number') throw new Error('Invalid claims');
      event.locals.user = { id: payload.sub, tenant_id: payload.tenant_id, email: payload.email, name: payload.name };
      event.locals.expiresAt = payload.exp * 1000;
    } catch {
      event.cookies.delete(COOKIE, { path: '/' });
    }
  }
  const publicRoute = event.url.pathname === '/onboarding' || event.url.pathname === '/health';
  if (!publicRoute && !event.locals.user) {
    if (event.url.pathname.startsWith('/api/')) return json({ message: 'Session expired' }, { status: 401 });
    redirect(303, token ? '/onboarding?message=expired' : '/onboarding');
  }
  const response = await resolve(event);
  if (event.locals.user || publicRoute) response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
};
