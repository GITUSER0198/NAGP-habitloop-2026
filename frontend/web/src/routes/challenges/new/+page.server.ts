import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { MyCommunity } from '$lib/types';
import { api, pageError } from '$lib/server/api';
import { requireFeature } from '../../community.server';

// Asks which community the new challenge goes to (default: the active one). The form itself lives under the community.
export const load: PageServerLoad = async (event) => {
  requireFeature('challenges');
  try {
    const mine = await api<MyCommunity[]>(event, '/api/users/communities');
    const choices = mine.filter(item => item.kind !== 'organization');
    if (choices.length === 1) redirect(303, `/communities/${choices[0].id}/challenges/new`);
    return { choices, active: choices.find(item => item.active)?.id ?? choices[0]?.id ?? '' };
  } catch (cause) { pageError(cause); }
};
