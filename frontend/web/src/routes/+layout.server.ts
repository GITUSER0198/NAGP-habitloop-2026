import type { LayoutServerLoad } from './$types';
import type { TodayItem } from '$lib/types';
import { api, ApiError, pageError } from '$lib/server/api';
import { features } from '$lib/config/features';
import type { Challenge, RecommendationList } from './community';

export const load: LayoutServerLoad = async (event) => {
  try {
    const badges = await Promise.allSettled([
      event.locals.user && features.challenges ? api<Challenge[]>(event, '/api/challenges/invites') : [],
      event.locals.user && features.recommendations
        ? api<RecommendationList>(event, '/api/recommendations').then(result => result.recommendations) : []
    ]);
    const [pendingInvites, pendingRecommendations] = badges.map(result => {
      if (result.status === 'fulfilled') return result.value.length;
      if (result.reason instanceof ApiError) return null;
      throw result.reason;
    });
    return {
      pendingInvites,
      pendingRecommendations,
      user: event.locals.user,
      expiresAt: event.locals.expiresAt,
      today: event.locals.user && features.reminders ? await api<TodayItem[]>(event, '/api/activities/today') : []
    };
  } catch (cause) { pageError(cause); }
};
