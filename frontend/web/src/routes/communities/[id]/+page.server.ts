import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { DiscoverCommunity, MyCommunity, User } from '$lib/types';
import { api, ApiError, pageError } from '$lib/server/api';
import { setSession } from '$lib/server/session';
import type { WallPage } from '$lib/wall';
import { post, resourceId } from '../../community.server';

type TokenResponse = { token: string; user: User; community: { id: string; name: string; kind: string } };

export const load: PageServerLoad = async (event) => {
  const id = decodeURIComponent(resourceId(event.params.id));
  try {
    const mine = (await api<MyCommunity[]>(event, '/api/users/communities')).find(item => item.id === id);
    // Non-members see the public face: name, description and Public challenges only.
    const found: Pick<MyCommunity, 'id' | 'name' | 'description' | 'member_count'> | undefined = mine
      ?? (await api<DiscoverCommunity[]>(event, '/api/users/communities/discover?q=')).find(item => item.id === id);
    if (!found) error(404, 'Community not found');
    const wall = await api<WallPage>(event, `/api/challenges/wall?community_id=${id}`);
    return { community: found, member: !!mine, role: mine?.role ?? null, kind: mine?.kind ?? 'community', wall };
  } catch (cause) { pageError(cause); }
};

export const actions: Actions = {
  join: async (event) => {
    const id = decodeURIComponent(resourceId(event.params.id));
    try { setSession(event, (await post<TokenResponse>(event, `/api/users/communities/${id}/join`)).token); }
    catch (cause) { if (!(cause instanceof ApiError)) throw cause; return fail(cause.status, { message: cause.message || 'Could not join this community.' }); }
    redirect(303, `/communities/${id}`);
  },
  leave: async (event) => {
    const id = decodeURIComponent(resourceId(event.params.id));
    try { setSession(event, (await post<TokenResponse>(event, `/api/users/communities/${id}/leave`)).token); }
    catch (cause) { if (!(cause instanceof ApiError)) throw cause; return fail(cause.status, { message: cause.message || 'Could not leave this community.' }); }
    redirect(303, `/communities/${id}`);
  }
};
