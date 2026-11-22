import type { Actions, PageServerLoad } from './$types';
import { api, pageError } from '$lib/server/api';
import { features } from '$lib/config/features';
import type { Challenge, ChallengeProgress } from '../community';
import { actionFailure, field, post, requireFeature, resourceId } from '../community.server';

export const load: PageServerLoad = async (event) => {
  requireFeature('challenges');
  try {
    const challenges = await api<Challenge[]>(event, '/api/challenges/feed');
    const me = event.locals.user?.id;
    const stats: Record<string, { participants: number; progress: number; joined: boolean }> = {};
    if (features.leaderboard) {
      // One failed progress call must not hide the feed; that card falls back to zeros.
      const results = await Promise.allSettled(challenges.map(challenge =>
        api<ChallengeProgress>(event, `/api/analytics/challenges/${challenge.id}/progress`)));
      results.forEach((result, index) => {
        if (result.status !== 'fulfilled') return;
        const rows = result.value.leaderboard ?? [];
        const mine = rows.find(row => row.user_id === me);
        stats[challenges[index].id] = { participants: rows.length, progress: mine?.count ?? 0, joined: !!mine };
      });
    }
    return { challenges, stats };
  } catch (cause) { pageError(cause); }
};
export const actions: Actions = {
  join: async (event) => {
    requireFeature('challenges');
    try {
      const id = resourceId(field(await event.request.formData(), 'id'));
      await post(event, `/api/challenges/${id}/join`);
      return { message: 'Challenge joined.', joined: id };
    } catch (cause) { return actionFailure(cause); }
  }
};
