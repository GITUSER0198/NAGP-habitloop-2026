import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { api, pageError } from '$lib/server/api';
import { features } from '$lib/config/features';
import type { Challenge } from '../community';
import { actionFailure, field, post, requireFeature, resourceId } from '../community.server';

export const load: PageServerLoad = async (event) => {
  requireFeature('challenges');
  try {
    const [challenges, invites, categories] = await Promise.all([
      api<Challenge[]>(event, '/api/challenges/feed'), api<Challenge[]>(event, '/api/challenges/invites'),
      features.categories ? api<Record<string, string>>(event, '/api/activities/categories') : {}
    ]);
    return { challenges, invites, categories };
  } catch (cause) { pageError(cause); }
};
export const actions: Actions = {
  create: async (event) => {
    requireFeature('challenges');
    const data = await event.request.formData();
    try {
      const challenge = await post<Challenge>(event, '/api/challenges', {
        title: field(data, 'title'), description: field(data, 'description'), visibility: field(data, 'visibility'),
        activity_category: field(data, 'activity_category'), start_date: field(data, 'start_date'),
        end_date: field(data, 'end_date'), target_count: Number(field(data, 'target_count'))
      });
      redirect(303, `/challenges/${challenge.id}`);
    } catch (cause) { return actionFailure(cause); }
  },
  joinCode: async (event) => {
    requireFeature('challenges');
    const data = await event.request.formData();
    try {
      const result = await post<{ challenge_id: string }>(event, '/api/challenges/join-by-code', {
        invite_code: field(data, 'invite_code').toUpperCase()
      });
      redirect(303, `/challenges/${result.challenge_id}`);
    } catch (cause) { return actionFailure(cause); }
  },
  join: async (event) => {
    requireFeature('challenges');
    try {
      const id = resourceId(field(await event.request.formData(), 'id'));
      await post(event, `/api/challenges/${id}/join`);
      return { message: 'Challenge joined.', joined: id };
    } catch (cause) { return actionFailure(cause); }
  },
  accept: async (event) => {
    requireFeature('challenges');
    try {
      const id = resourceId(field(await event.request.formData(), 'id'));
      await post(event, `/api/challenges/invites/${id}/accept`);
      return { message: 'Invitation accepted.', joined: id };
    } catch (cause) { return actionFailure(cause); }
  },
  decline: async (event) => {
    requireFeature('challenges');
    try {
      const id = resourceId(field(await event.request.formData(), 'id'));
      await post(event, `/api/challenges/invites/${id}/decline`);
      return { message: 'Invitation declined.' };
    } catch (cause) { return actionFailure(cause); }
  }
};
