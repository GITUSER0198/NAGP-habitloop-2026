import type { AppState } from '$lib/state/app.svelte';
import type { DashboardData, Summary } from '$lib/types';

export function startLive(state: AppState, expiresAt: number): () => void {
  let source: EventSource | undefined;
  let polling: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  let inFlight: Promise<void> | undefined;
  let again = false;
  const abort = new AbortController();
  const expire = (): void => { window.location.assign('/onboarding?message=expired'); };
  const expiry = setTimeout(expire, Math.max(0, expiresAt - Date.now()));

  function refresh(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (inFlight) { again = true; return inFlight; }
    inFlight = (async () => {
      do {
        again = false;
        try {
          const response = await fetch('/api/dashboard', {
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]), cache: 'no-store'
          });
          if (response.status === 401 || response.redirected) { expire(); return; }
          if (!response.ok) throw new Error('Refresh failed');
          state.apply(await response.json() as DashboardData);
          if (polling) state.connection = 'Polling every 10 seconds';
        } catch {
          if (!stopped) state.connection = 'Updates unavailable. Retrying.';
        }
      } while (again && !stopped);
    })().finally(() => { inFlight = undefined; });
    return inFlight;
  }

  function fallback(): void {
    source?.close();
    state.connection = 'Polling every 10 seconds';
    if (!polling) { void refresh(); polling = setInterval(() => void refresh(), 10000); }
  }

  if (typeof EventSource === 'undefined') fallback();
  else {
    source = new EventSource('/api/analytics/stream');
    source.onopen = () => { state.connection = 'Live updates connected'; };
    source.addEventListener('summary', (event: MessageEvent<string>) => {
      try { state.summary.value = JSON.parse(event.data) as Summary; void refresh(); }
      catch { fallback(); }
    });
    source.onerror = fallback;
  }
  const minute = setInterval(() => { state.today.now = Date.now(); void refresh(); }, 60000);
  state.refresh = refresh;
  void refresh();
  return () => {
    stopped = true; abort.abort(); source?.close();
    clearInterval(polling); clearInterval(minute); clearTimeout(expiry);
    state.refresh = async () => {};
  };
}
