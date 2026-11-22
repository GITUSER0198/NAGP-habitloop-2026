import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { api, pageError } from '$lib/server/api';
import { features } from '$lib/config/features';
import type { Challenge } from '../../community';
import { actionFailure, field, post, requireFeature } from '../../community.server';

export const load: PageServerLoad = async (event) => {
  requireFeature('challenges');
  try {
    const categories = features.categories ? await api<Record<string, string>>(event, '/api/activities/categories') : {};
    return { categories };
  } catch (cause) { pageError(cause); }
};
export const actions: Actions = {
  create: async (event) => {
    requireFeature('challenges');
    const data = await event.request.formData();
    const value = field(data, 'caring_value');
    const image = field(data, 'image_url');
    try {
      await post<Challenge>(event, '/api/challenges', {
        title: field(data, 'title'), description: field(data, 'description'),
        visibility: field(data, 'visibility') === 'members' ? 'members' : 'public',
        activity_category: field(data, 'activity_category') || 'other', start_date: field(data, 'start_date'),
        end_date: field(data, 'end_date'), target_count: Number(field(data, 'target_count')),
        ...(value ? { caring_value: value } : {}), ...(image ? { image_url: image } : {})
      });
    } catch (cause) { return actionFailure(cause); }
    redirect(303, '/');
  }
};
