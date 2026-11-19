import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dashboard } from '$lib/server/dashboard';
import { pageError } from '$lib/server/api';

export const GET: RequestHandler = async (event) => {
  try { return json(await dashboard(event)); }
  catch (cause) { pageError(cause); }
};
