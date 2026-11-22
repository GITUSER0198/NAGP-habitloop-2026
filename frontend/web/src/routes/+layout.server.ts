import type { LayoutServerLoad } from './$types';
import type { MyCommunity, TodayItem } from '$lib/types';
import { api, ApiError, pageError } from '$lib/server/api';
import { features } from '$lib/config/features';
import type { RecommendationList } from './community';

export const load: LayoutServerLoad = async (event) => {
  try {
    const badges = await Promise.allSettled([
      event.locals.user && features.recommendations
        ? api<RecommendationList>(event, '/api/recommendations').then(result => result.recommendations) : []
    ]);
    const [pendingRecommendations] = badges.map(result => {
      if (result.status === 'fulfilled') return result.value.length;
      if (result.reason instanceof ApiError) return null;
      throw result.reason;
    });
    // The switcher needs my communities; the app still works (without it) if this call fails.
    let communities: MyCommunity[] = [];
    if (event.locals.user) {
      try { communities = await api<MyCommunity[]>(event, '/api/users/communities'); }
      catch (cause) { if (!(cause instanceof ApiError)) throw cause; }
    }
    return {
      communities,
      community: communities.find(item => item.id === event.locals.user?.tenant_id) ?? null,
      organization: communities.find(item => item.kind === 'organization') ?? null,
      pendingRecommendations,
      user: event.locals.user,
      expiresAt: event.locals.expiresAt,
      today: event.locals.user && features.reminders ? await api<TodayItem[]>(event, '/api/activities/today') : []
    };
  } catch (cause) { pageError(cause); }
};
