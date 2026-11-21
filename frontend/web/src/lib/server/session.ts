import type { RequestEvent } from '@sveltejs/kit';
import { decodeJwt } from 'jose';
import { COOKIE } from './api';

/** Store (or replace) the session cookie with a token from the User Service. */
export function setSession(event: RequestEvent, token: string): void {
  const expires = decodeJwt(token).exp;
  event.cookies.set(COOKIE, token, {
    path: '/', httpOnly: true, secure: event.url.protocol === 'https:', sameSite: 'lax',
    maxAge: expires ? Math.max(0, expires - Math.floor(Date.now() / 1000)) : 3600
  });
}

/** Only same-site paths are allowed as a post-action destination. */
export function safePath(value: string, fallback: string): string {
  return value.startsWith('/') && !value.startsWith('//') && !value.includes(String.fromCharCode(92)) ? value : fallback;
}
