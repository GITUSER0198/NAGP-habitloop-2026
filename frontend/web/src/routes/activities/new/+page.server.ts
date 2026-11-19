import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { api, pageError } from '$lib/server/api';
import { saveActivity } from '$lib/server/activity-form';
import { features } from '$lib/config/features';

export const load: PageServerLoad = async (event) => {
  try { return { categories: features.categories ? await api<Record<string, string>>(event, '/api/activities/categories') : {} }; }
  catch (cause) { pageError(cause); }
};
export const actions: Actions = {
  default: async (event) => {
    const result = await saveActivity(event);
    if ('activity' in result) redirect(303, `/activities/${result.activity.id}?created=1`);
    return result;
  }
};
