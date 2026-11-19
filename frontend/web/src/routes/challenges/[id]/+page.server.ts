import type { Actions, PageServerLoad } from './$types';
import { api, pageError, ApiError } from '$lib/server/api';
import { features } from '$lib/config/features';
import type { Challenge, ChallengeProgress } from '../../community';
import { actionFailure, field, post, requireFeature, resourceId } from '../../community.server';

export const load: PageServerLoad = async (event) => {
  requireFeature('challenges');
  try {
    const id = resourceId(event.params.id);
    const challenge = await api<Challenge>(event, `/api/challenges/${id}`);
    let progress: ChallengeProgress | null = null;
    let progressError = '';
    if (features.leaderboard) {
      try { progress = await api<ChallengeProgress>(event, `/api/analytics/challenges/${id}/progress`); }
      catch (cause) { if (!(cause instanceof ApiError)) throw cause; progressError = cause.message; }
    }
    return { challenge, progress, progressError };
  } catch (cause) { pageError(cause); }
};
export const actions: Actions = {
  invite: async (event) => {
    requireFeature('challenges');
    try {
      const data = await event.request.formData();
      const recipient = field(data, 'user_id');
      if (recipient) resourceId(recipient);
      const invitation = await post<{ invite_code: string }>(event, `/api/challenges/${resourceId(event.params.id)}/invites`, {
        user_ids: recipient ? [recipient] : []
      });
      return { code: invitation.invite_code, message: recipient ? 'Invitation sent.' : 'Share this invite code.' };
    } catch (cause) { return actionFailure(cause); }
  }
};
