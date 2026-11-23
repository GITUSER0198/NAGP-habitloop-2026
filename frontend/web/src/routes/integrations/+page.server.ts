import type { Actions, PageServerLoad } from './$types';
import type { Activity } from '$lib/types';
import { api, apiResponse, ApiError, pageError } from '$lib/server/api';
import type { LinkSecret, PartnerEvent, PartnerLink, Provider } from '../community';
import { actionFailure, field, post, requireFeature, resourceId } from '../community.server';
import type { WearableStats } from './types';

export const load: PageServerLoad = async (event) => {
  requireFeature('integrations');
  event.depends('wearable:stats');
  try {
    const [providers, links, activities] = await Promise.all([
      api<Provider[]>(event, '/api/integrations/providers'), api<PartnerLink[]>(event, '/api/integrations/links'),
      api<Activity[]>(event, '/api/activities')
    ]);
    const events = (await Promise.all(links.filter(link => link.provider !== 'galaxywatch').map(link => api<PartnerEvent[]>(event, `/api/integrations/links/${link.id}/events`))))
      .flat().sort((a, b) => b.received_at.localeCompare(a.received_at)).slice(0, 50);
    const stats = Object.fromEntries(await Promise.all(links.filter(link => link.provider === 'galaxywatch').map(async link =>
      [link.id, await api<WearableStats>(event, `/api/integrations/links/${link.id}/stats?days=7`)] as const)));
    return { providers, links, activities: activities.filter(activity => activity.active), events, stats, updatedAt: Date.now() };
  } catch (cause) { pageError(cause); }
};
export const actions: Actions = {
  mapping: async (event) => {
    requireFeature('integrations');
    try {
      const data = await event.request.formData();
      const id = resourceId(field(data, 'id'));
      const activity_map: Record<string, string | null> = {};
      for (const [key, value] of data) if (key.startsWith('map:')) activity_map[key.slice(4)] = String(value) ? resourceId(String(value)) : null;
      await api(event, `/api/integrations/links/${id}`, { method: 'PATCH', body: JSON.stringify({ activity_map }) });
      return { message: 'Activity mapping saved.' };
    } catch (cause) { return actionFailure(cause); }
  },
  link: async (event) => {
    requireFeature('integrations');
    try {
      const data = await event.request.formData();
      const provider = field(data, 'provider');
      const providers = await api<Provider[]>(event, '/api/integrations/providers');
      const definition = providers.find(item => item.provider === provider);
      if (!definition) throw new ApiError(400, 'Choose a supported provider.');
      const activityMap: Record<string, string> = {};
      for (const type of definition.activity_types) {
        const id = field(data, `map:${type}`);
        if (id) activityMap[type] = resourceId(id);
      }
      if (!Object.keys(activityMap).length) throw new ApiError(400, 'Map at least one provider activity before linking.');
      const result = await post<PartnerLink & { ingest_key: string }>(event, '/api/integrations/links', { provider, activity_map: activityMap });
      const secret: LinkSecret = { id: result.id, ingest_key: result.ingest_key, providerActivity: Object.keys(activityMap)[0] };
      return { secret, message: 'Provider linked. Save the key now. It will not be shown again.' };
    } catch (cause) { return actionFailure(cause); }
  },
  unlink: async (event) => {
    requireFeature('integrations');
    try {
      const id = resourceId(field(await event.request.formData(), 'id'));
      await apiResponse(event, `/api/integrations/links/${id}`, { method: 'DELETE' });
      return { message: 'Provider disconnected.' };
    } catch (cause) { return actionFailure(cause); }
  },
  events: async () => { requireFeature('integrations'); return { message: 'Recent events updated.' }; }
};
