import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { api, ApiError, pageError } from '$lib/server/api';
import { features } from '$lib/config/features';
import type { Summary } from '$lib/types';
import type { WallPage } from '$lib/wall';

export const load: PageServerLoad = async (event) => {
  if (!features.wall) redirect(303, '/dashboard');
  const community = event.url.searchParams.get('community') ?? '';
  const filter = /^[0-9a-f-]{36}$/i.test(community) ? community : '';
  try {
    const [wall, summary] = await Promise.all([
      api<WallPage>(event, `/api/challenges/wall${filter ? `?community_id=${filter}` : ''}`),
      api<Summary>(event, '/api/analytics/summary').catch((cause: unknown) => { if (cause instanceof ApiError) return null; throw cause; })
    ]);
    return { wall, summary, filter };
  } catch (cause) { pageError(cause); }
};
