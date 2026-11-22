import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { api, ApiError, pageError } from '$lib/server/api';
import { features } from '$lib/config/features';
import type { Summary } from '$lib/types';
import type { WallPage } from '$lib/wall';

export const load: PageServerLoad = async (event) => {
  if (!features.wall) redirect(303, '/dashboard');
  try {
    const [wall, summary] = await Promise.all([
      api<WallPage>(event, '/api/challenges/wall'),
      api<Summary>(event, '/api/analytics/summary').catch((cause: unknown) => { if (cause instanceof ApiError) return null; throw cause; })
    ]);
    return { wall, summary };
  } catch (cause) { pageError(cause); }
};
