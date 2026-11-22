import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { DiscoverCommunity, MyCommunity, User } from '$lib/types';
import { api, ApiError, pageError } from '$lib/server/api';
import type { Challenge } from '../community';
import { safePath, setSession } from '$lib/server/session';
import { field, post, resourceId } from '../community.server';

type TokenResponse = { token: string; user: User; community: { id: string; name: string; kind: string } };

export const load: PageServerLoad = async (event) => {
  const q = (event.url.searchParams.get('q') ?? '').trim().slice(0, 100);
  try {
    const [mine, discover] = await Promise.all([
      api<MyCommunity[]>(event, '/api/users/communities'),
      api<DiscoverCommunity[]>(event, `/api/users/communities/discover?q=${encodeURIComponent(q)}`)
    ]);
    // Public challenges are visible on each Discover card; joining one needs the community first.
    const found = await Promise.allSettled(discover.map(item => api<Challenge[]>(event, `/api/challenges/public/${item.id}`)));
    const publicChallenges: Record<string, Challenge[]> = {};
    found.forEach((result, index) => { if (result.status === 'fulfilled') publicChallenges[discover[index].id] = result.value; });
    return { mine, discover, publicChallenges, q, welcome: event.url.searchParams.get('welcome') === '1' };
  } catch (cause) { pageError(cause); }
};

function failure(cause: unknown, fallback: string) {
  if (!(cause instanceof ApiError)) throw cause;
  return fail(cause.status, { message: cause.message || fallback });
}

export const actions: Actions = {
  create: async (event) => {
    const data = await event.request.formData();
    const name = field(data, 'name');
    const description = field(data, 'description');
    if (name.length < 3 || name.length > 60) return fail(400, { message: 'Community names are 3 to 60 characters.', name, description });
    try {
      const result = await post<TokenResponse>(event, '/api/users/communities', { name, description });
      setSession(event, result.token);
    } catch (cause) {
      if (cause instanceof ApiError) return fail(cause.status, { message: cause.message, name, description });
      throw cause;
    }
    redirect(303, '/dashboard');
  },
  join: async (event) => {
    const data = await event.request.formData();
    try {
      const result = await post<TokenResponse>(event, `/api/users/communities/${resourceId(field(data, 'community_id'))}/join`);
      setSession(event, result.token);
    } catch (cause) { return failure(cause, 'Could not join this community.'); }
    redirect(303, '/dashboard');
  },
  leave: async (event) => {
    const data = await event.request.formData();
    try {
      const result = await post<TokenResponse>(event, `/api/users/communities/${resourceId(field(data, 'community_id'))}/leave`);
      setSession(event, result.token);
      return { message: `You left ${field(data, 'community_name') || 'the community'}.` };
    } catch (cause) { return failure(cause, 'Could not leave this community.'); }
  },
  switch: async (event) => {
    const data = await event.request.formData();
    try {
      const result = await post<TokenResponse>(event, '/api/users/switch', { community_id: field(data, 'community_id') });
      setSession(event, result.token);
    } catch (cause) { return failure(cause, 'Could not switch community.'); }
    redirect(303, safePath(field(data, 'redirect_to'), '/dashboard'));
  }
};
