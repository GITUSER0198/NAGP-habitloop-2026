import { getContext, setContext } from 'svelte';

export class CommunityState {
  recommendations = $state<number | null>(null);
}
const key = Symbol('community');
export function provideCommunity(): CommunityState { return setContext(key, new CommunityState()); }
export function useCommunity(): CommunityState { return getContext<CommunityState>(key); }
