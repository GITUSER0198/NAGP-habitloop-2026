import type { LayoutServerLoad } from './$types';
import type { TodayItem } from '$lib/types';
import { api, pageError } from '$lib/server/api';
import { features } from '$lib/config/features';

export const load: LayoutServerLoad = async (event) => {
  try {
    return {
      user: event.locals.user,
      expiresAt: event.locals.expiresAt,
      today: event.locals.user && features.reminders ? await api<TodayItem[]>(event, '/api/activities/today') : []
    };
  } catch (cause) { pageError(cause); }
};
