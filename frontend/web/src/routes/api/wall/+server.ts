import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { api, pageError } from '$lib/server/api';
import type { WallPage } from '$lib/wall';

export const GET: RequestHandler = async (event) => {
  const cursor = event.url.searchParams.get('cursor');
  try { return json(await api<WallPage>(event, `/api/challenges/wall${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)); }
  catch (cause) { pageError(cause); }
};
