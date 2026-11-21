import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { api, ApiError } from '$lib/server/api';

function slug(value: string): string {
  return value.normalize('NFKD').replace(/[^\x00-\x7F]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Public lookup for the register form: does this community exist yet? */
export const GET: RequestHandler = async (event) => {
  const key = slug(event.url.searchParams.get('name') ?? '');
  if (!key) return json({ valid: false }, { status: 400 });
  try {
    const tenant = await api<{ exists: boolean; name: string | null }>(event, `/api/users/tenants/${encodeURIComponent(key)}`, {}, false);
    return json({ valid: true, exists: tenant.exists, name: tenant.name });
  } catch (cause) {
    if (!(cause instanceof ApiError)) throw cause;
    return json({ valid: false }, { status: cause.status });
  }
};
