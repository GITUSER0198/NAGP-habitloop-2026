import type { PageServerLoad } from './$types';
import { dashboard } from '$lib/server/dashboard';
import { pageError } from '$lib/server/api';

export const load: PageServerLoad = async (event) => {
  try { return { dashboard: await dashboard(event) }; }
  catch (cause) { pageError(cause); }
};
