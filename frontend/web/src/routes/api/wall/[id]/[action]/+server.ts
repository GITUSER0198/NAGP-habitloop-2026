import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { api, pageError } from '$lib/server/api';
import { resourceId } from '../../../../community.server';

/** `like` and `comments` take a post id; `join` takes the challenge id. */
function target(id: string, action: string): string {
  const safe = resourceId(id);
  if (action === 'like') return `/api/challenges/wall/${safe}/like`;
  if (action === 'comments') return `/api/challenges/wall/${safe}/comments`;
  if (action === 'join') return `/api/challenges/${safe}/join`;
  error(404, 'Not found');
}

export const GET: RequestHandler = async (event) => {
  if (event.params.action !== 'comments') error(404, 'Not found');
  try { return json(await api(event, target(event.params.id, 'comments'))); } catch (cause) { pageError(cause); }
};
export const POST: RequestHandler = async (event) => {
  const body = event.params.action === 'comments' ? await event.request.text() : undefined;
  try { return json(await api(event, target(event.params.id, event.params.action), { method: 'POST', ...(body ? { body } : {}) })); }
  catch (cause) { pageError(cause); }
};
