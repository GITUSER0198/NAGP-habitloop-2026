import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { MyCommunity } from '$lib/types';
import { api, pageError } from '$lib/server/api';
import { features } from '$lib/config/features';
import type { Challenge } from '../../../../community';
import { actionFailure, field, post, requireFeature, resourceId } from '../../../../community.server';

export const load: PageServerLoad = async (event) => {
  requireFeature('challenges');
  const id = decodeURIComponent(resourceId(event.params.id));
  try {
    // Posting is for members only; the challenge is created in this community whatever the active one is.
    const target = (await api<MyCommunity[]>(event, '/api/users/communities')).find(item => item.id === id);
    if (!target) error(403, 'Join this community to post a challenge.');
    const categories = features.categories ? await api<Record<string, string>>(event, '/api/activities/categories') : {};
    return { categories, target: { id: target.id, name: target.name } };
  } catch (cause) { pageError(cause); }
};
export const actions: Actions = {
  create: async (event) => {
    requireFeature('challenges');
    const communityId = decodeURIComponent(resourceId(event.params.id));
    const data = await event.request.formData();
    const image = field(data, 'image_url');
    try {
      await post<Challenge>(event, '/api/challenges', {
        community_id: communityId,
        title: field(data, 'title'), description: field(data, 'description'),
        visibility: field(data, 'visibility') === 'members' ? 'members' : 'public',
        activity_category: field(data, 'activity_category') || 'other', start_date: field(data, 'start_date'),
        end_date: field(data, 'end_date'), target_count: Number(field(data, 'target_count')),
        ...(image ? { image_url: image } : {})
      });
    } catch (cause) { return actionFailure(cause); }
    redirect(303, `/communities/${communityId}`);
  }
};
