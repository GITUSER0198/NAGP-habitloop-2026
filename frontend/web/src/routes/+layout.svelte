<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { LayoutProps } from './$types';
  import { page } from '$app/state';
  import '../../../theme/tokens.css';
  import '@habitloop/components/dist/habitloop/habitloop.css';
  import '$lib/styles.css';
  import { features } from '$lib/config/features';
  import { app } from '$lib/config/app';
  import { provideState } from '$lib/state/app.svelte';
  import { startLive } from '$lib/live.svelte';
  import { logNow } from '$lib/log.svelte';
  import { rememberOpen } from '$lib/disclosure';
  import Busy from '$lib/components/Busy.svelte';

  let { data, children }: LayoutProps = $props();
  const model = provideState(untrack(() => data.today));
  let mode = $state('dark');
  let menuOpen = $state(false);
  const nav = app.nav.filter(item => !item.feature || features[item.feature]);
  const snoozeKey = $derived(`habitloop:snoozes:${data.user?.tenant_id}:${data.user?.id}`);

  onMount(() => {
    mode = document.documentElement.dataset.mode ?? 'dark';
    void import('@habitloop/components/loader').then(({ defineCustomElements }) => defineCustomElements());
    return () => model.toasts.destroy();
  });
  $effect(() => { model.today.items = data.today; });
  $effect(() => {
    if (!data.user) return;
    model.today.restore(snoozeKey);
    model.today.now = Date.now();
    return startLive(model, data.expiresAt);
  });

  function toggleMode(): void {
    mode = mode === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.mode = mode;
    try { localStorage.setItem('habitloop:mode', mode); } catch { /* Theme still works without storage. */ }
  }
</script>

<svelte:head><title>{app.name}</title><meta name="description" content={app.tagline} /></svelte:head>
<a class="skip" href="#main">Skip to content</a>
<header>
  <a class="brand" href={data.user ? '/dashboard' : '/onboarding'}>{app.name}</a>
  {#if data.user}
    <button class="menu-button secondary" aria-expanded={menuOpen} aria-controls="main-nav" onclick={() => menuOpen = !menuOpen}>Menu</button>
    <nav id="main-nav" class:menu-open={menuOpen} aria-label="Main navigation">
      {#each nav as item}
        <a href={item.href} aria-current={page.url.pathname === item.href ? 'page' : undefined} onclick={() => menuOpen = false}>{item.label}</a>
      {/each}
    </nav>
    {#if features.reminders}
      <a class="bell" href={model.today.reminders.length ? '#reminders' : '/dashboard'} aria-label={`${model.today.reminders.length} reminders`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
        <span>Reminders ({model.today.reminders.length})</span>
      </a>
    {/if}
  {/if}
  <button class="secondary" onclick={toggleMode} aria-label={`Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`}>{mode === 'dark' ? 'Light mode' : 'Dark mode'}</button>
  {#if data.user}
    <details class="user-menu" use:rememberOpen={'user-menu'}><summary>{data.user.name}</summary>
      <div><p>{data.user.email}</p><form method="POST" action="/logout"><button type="submit" class="secondary">Log out</button></form></div>
    </details>
  {/if}
</header>
<main id="main">
  {#if data.user && features.reminders && model.today.reminders.length}
    <section id="reminders" aria-label="Due soon">
      <hl-reminder-banner id="today-reminders" items={JSON.stringify(model.today.reminders)} busy={model.today.reminderBusy}
        onhlLogNow={(event) => void logNow(model, event.detail.activityId, 'done')}
        onhlSnooze={(event) => model.today.snooze(event.detail.activityId, snoozeKey)}></hl-reminder-banner>
      {#if model.today.reminderBusy}<Busy label="Logging your reminder" />{/if}
      {#each model.today.reminders as reminder}
        {#if model.today.errors[reminder.activityId]}<p class="error" role="alert">{reminder.name}: {model.today.errors[reminder.activityId]}</p>{/if}
      {/each}
    </section>
  {/if}
  {@render children()}
</main>
<aside class="toasts" aria-label="Notifications" aria-live="polite">
  {#each model.toasts.items as toast (toast.id)}
    <div class:toast-error={toast.error} class="toast">{toast.message}<button class="secondary" aria-label="Dismiss notification" onclick={() => model.toasts.dismiss(toast.id)}>Close</button></div>
  {/each}
</aside>
