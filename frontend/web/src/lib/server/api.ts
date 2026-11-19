import { env } from '$env/dynamic/private';
import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import type { FieldErrors } from '$lib/types';

export const COOKIE = 'habitloop_session';

export class ApiError extends Error {
  constructor(public status: number, message: string, public fields: FieldErrors = {}) {
    super(message);
  }
}

export function expireSession(event: RequestEvent): never {
  event.cookies.delete(COOKIE, { path: '/' });
  redirect(303, '/onboarding?message=expired');
}

export async function apiResponse(
  event: RequestEvent, path: string, init: RequestInit = {}, authenticated = true
): Promise<Response> {
  if (!env.API_BASE_URL) throw new ApiError(503, 'The API is unavailable.');
  const headers = new Headers(init.headers);
  if (authenticated) headers.set('Authorization', `Bearer ${event.cookies.get(COOKIE) ?? ''}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await event.fetch(`${env.API_BASE_URL.replace(/\/$/, '')}${path}`, {
      ...init, headers, signal: init.signal ?? AbortSignal.timeout(10000), redirect: 'manual'
    });
  } catch {
    throw new ApiError(503, 'The service is unavailable. Please try again.');
  }
  if (authenticated && response.status === 401) expireSession(event);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const fields: FieldErrors = {};
    if (Array.isArray(payload.detail)) {
      for (const issue of payload.detail) fields[String(issue.loc?.[1] ?? '_form')] = issue.msg;
    }
    throw new ApiError(response.status, typeof payload.detail === 'string' ? payload.detail : 'Please check the fields below.', fields);
  }
  return response;
}

export async function api<T>(event: RequestEvent, path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  const response = await apiResponse(event, path, init, authenticated);
  return response.json() as Promise<T>;
}

export function pageError(cause: unknown): never {
  if (cause instanceof ApiError) error(cause.status >= 500 ? 503 : cause.status, cause.message);
  throw cause;
}
