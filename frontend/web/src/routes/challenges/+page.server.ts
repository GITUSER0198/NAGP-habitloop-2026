import type { Actions, PageServerLoad } from './$types';
import { api, pageError } from '$lib/server/api';
import { features } from '$lib/config/features';
import type { MyCommunity } from '$lib/types';
import type { Challenge, ChallengeProgress } from '../community';
import { actionFailure, field, post, requireFeature, resourceId } from '../community.server';

export const load: PageServerLoad = async (event) => {
  requireFeature('challenges');
  try {
    // Challenges across every community I belong to, grouped by community on the page.
    const all = await api<{ communities: { id: string; name: string; kind: string }[]; challenges: Challenge[] }>(event, '/api/challenges/mine');
    const challenges = all.challenges;
    const mine = await api<MyCommunity[]>(event, '/api/users/communities').catch(() => [] as MyCommunity[]);
    const groups = all.communities.filter(item => item.kind !== 'organization')
      .map(item => ({ id: item.id, name: mine.find(row => row.id === item.id)?.name ?? item.name, challenges: challenges.filter(row => row.tenant_id === item.id) }))
      .filter(group => group.challenges.length > 0);
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
    return { challenges, groups, stats };
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
