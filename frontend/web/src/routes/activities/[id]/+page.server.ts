import type { Actions, PageServerLoad } from './$types';
import type { Activity, ActivityLog } from '$lib/types';
import { api, pageError } from '$lib/server/api';
import { saveActivity, logActivity } from '$lib/server/activity-form';
import { features } from '$lib/config/features';

export const load: PageServerLoad = async (event) => {
  try {
    const path = `/api/activities/${encodeURIComponent(event.params.id)}`;
    const [activity, logs, categories] = await Promise.all([
      api<Activity>(event, path), api<ActivityLog[]>(event, `${path}/logs`),
      features.categories ? api<Record<string, string>>(event, '/api/activities/categories') : {}
    ]);
    return { activity, logs, categories, created: event.url.searchParams.has('created') };
  } catch (cause) { pageError(cause); }
};
export const actions: Actions = {
  edit: (event) => saveActivity(event, event.params.id),
  log: (event) => logActivity(event, event.params.id)
};
