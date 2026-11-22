import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { api, pageError } from '$lib/server/api';
import type { WallPage } from '$lib/wall';

export const GET: RequestHandler = async (event) => {
  const query = new URLSearchParams();
  for (const key of ['cursor', 'community_id']) { const value = event.url.searchParams.get(key); if (value) query.set(key, value); }
  try { return json(await api<WallPage>(event, `/api/challenges/wall${query.size ? `?${query}` : ''}`)); }
  catch (cause) { pageError(cause); }
};
