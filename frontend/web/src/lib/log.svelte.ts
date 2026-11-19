import { applyAction, deserialize } from '$app/forms';
import type { AppState } from '$lib/state/app.svelte';
import type { Status } from '$lib/types';
import { app } from '$lib/config/app';

export async function logNow(state: AppState, id: string, status: Status): Promise<void> {
  if (state.today.busy[id]) return;
  state.today.busy[id] = true;
  delete state.today.errors[id];
  const body = new FormData();
  body.set('status', status);
  try {
    const response = await fetch(`/activities/${encodeURIComponent(id)}?/log`, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
    if (response.redirected || response.status === 401) { window.location.assign('/onboarding?message=expired'); return; }
    const result = deserialize(await response.text());
    if (result.type === 'redirect' || result.type === 'error') { await applyAction(result); return; }
    if (result.type === 'failure') {
      const data = result.data as { logErrors?: { status?: string } } | undefined;
      throw new Error(data?.logErrors?.status ?? 'Could not log the activity.');
    }
    const item = state.today.items.find(item => item.id === id);
    if (item) item.status = status;
    state.toasts.push(app.strings.logSaved);
    await state.refresh();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Could not log the activity.';
    state.today.errors[id] = message;
    state.toasts.push(message, true);
  } finally { state.today.busy[id] = false; }
}
