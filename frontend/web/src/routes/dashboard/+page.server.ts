import { fail, type RequestEvent } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { dashboard } from '$lib/server/dashboard';
import { api, ApiError, pageError } from '$lib/server/api';
import { features } from '$lib/config/features';
import type { Recommendation, RecommendationList } from '../community';
import { actionFailure, field, post, requireFeature, resourceId } from '../community.server';

/** The newest pending suggestion, or null when the feature is off or the service is unreachable. */
async function nextSuggestion(event: RequestEvent): Promise<Recommendation | null> {
  if (!features.recommendations) return null;
  try { return (await api<RecommendationList>(event, '/api/recommendations')).recommendations[0] ?? null; }
  catch (cause) { if (cause instanceof ApiError) return null; throw cause; }
}

export const load: PageServerLoad = async (event) => {
  try {
    const [dashboardData, suggestion] = await Promise.all([dashboard(event), nextSuggestion(event)]);
    return { dashboard: dashboardData, suggestion };
  }
  catch (cause) { pageError(cause); }
};

export const actions: Actions = {
  accept: async (event) => {
    requireFeature('recommendations');
    let id = '';
    try {
      id = resourceId(field(await event.request.formData(), 'id'));
      await post<Recommendation>(event, `/api/recommendations/${id}/accept`);
      return { message: 'Suggestion accepted. Your activity schedule has changed.' };
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) return fail(409, { message: 'This suggestion no longer applies.' });
      return actionFailure(cause);
    }
  }
};
