import type { FastifyRequest } from 'fastify';
import { getConfig } from '@habitloop/shared';

export type CommunityRef = { id: string; name: string; kind: string };

/**
 * Communities (tenants) the caller belongs to, from the User Service internal endpoint. If the lookup fails the
 * caller is treated as a member of the active community only, so nothing from another tenant can leak.
 */
export async function memberCommunities(request: FastifyRequest): Promise<CommunityRef[]> {
  const identity = request.user!;
  try {
    const response = await fetch(`${process.env.USER_SERVICE_URL ?? 'http://user-service:47820'}/api/users/internal/users/${identity.userId}/communities`, {
      headers: { 'x-internal-token': getConfig().internalToken, ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}) },
      signal: AbortSignal.timeout(3000)
    });
    const value = response.ok ? await response.json() as unknown : null;
    if (Array.isArray(value)) {
      const list = value.filter((item): item is CommunityRef => typeof item === 'object' && item !== null && typeof (item as CommunityRef).id === 'string')
        .map(item => ({ id: item.id, name: String(item.name ?? ''), kind: String(item.kind ?? 'community') }));
      if (list.length > 0) return list;
    }
  } catch { /* fall through to the active community */ }
  return [{ id: identity.tenantId, name: '', kind: 'community' }];
}
