import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { Activity } from '$lib/types';
import { api, ApiError, pageError } from '$lib/server/api';
import type { Recommendation, RecommendationList } from '../community';
import { actionFailure, field, post, requireFeature, resourceId } from '../community.server';

export const load: PageServerLoad = async (event) => {
  requireFeature('recommendations');
  try {
    const [pending, accepted, dismissed, activities] = await Promise.all([
      api<RecommendationList>(event, '/api/recommendations'),
      api<RecommendationList>(event, '/api/recommendations?status=accepted'),
      api<RecommendationList>(event, '/api/recommendations?status=dismissed'),
      api<Activity[]>(event, '/api/activities')
    ]);
    return { pending: pending.recommendations, reason: pending.reason,
      history: [...accepted.recommendations, ...dismissed.recommendations].sort((a, b) => b.created_at.localeCompare(a.created_at)), activities };
  } catch (cause) { pageError(cause); }
};
export const actions: Actions = {
  history: async (event) => {
    requireFeature('recommendations');
    try {
      await Promise.all([api(event, '/api/activities'), api(event, '/api/analytics/trend?days=14')]);
      return { message: 'History read.' };
    } catch (cause) { return actionFailure(cause); }
  },
  refresh: async (event) => {
    requireFeature('recommendations');
    try {
      const result = await post<RecommendationList>(event, '/api/recommendations/refresh');
      return { message: `Done, ${result.recommendations.length} suggestions`, reason: result.reason };
    } catch (cause) { return actionFailure(cause); }
  },
  accept: async (event) => {
    requireFeature('recommendations');
    let id = '';
    try {
      id = resourceId(field(await event.request.formData(), 'id'));
      const accepted = await post<Recommendation>(event, `/api/recommendations/${id}/accept`);
      return { message: 'Suggestion accepted. Your activity schedule has changed.', accepted };
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) return fail(409, { message: 'No longer applies', removed: id });
      return actionFailure(cause);
    }
  },
  dismiss: async (event) => {
    requireFeature('recommendations');
    try {
      const id = resourceId(field(await event.request.formData(), 'id'));
      await post(event, `/api/recommendations/${id}/dismiss`);
      return { message: 'Suggestion dismissed.' };
    } catch (cause) { return actionFailure(cause); }
  }
};
