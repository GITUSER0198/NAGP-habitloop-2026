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
  import Busy from '$lib/components/Busy.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { rememberedCommunity } from '$lib/community-name';
  import { provideCommunity } from './community.svelte';

  let { data, children }: LayoutProps = $props();
  const model = provideState(untrack(() => data.today));
  const community = provideCommunity();
  $effect(() => {
    community.invites = data.pendingInvites;
    community.recommendations = data.pendingRecommendations;
  });
  let mode = $state('light');
  let menuOpen = $state(false);
  let userOpen = $state(false);
  let communityName = $state('');
  const initials = $derived((data.user?.name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0].toUpperCase()).join('') || '?');
  const nav = app.nav.filter(item => !item.feature || features[item.feature]);
  const snoozeKey = $derived(`habitloop:snoozes:${data.user?.tenant_id}:${data.user?.id}`);

  onMount(() => {
    mode = document.documentElement.dataset.mode ?? 'light';
    communityName = rememberedCommunity();
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

  function closeMenus(event: MouseEvent): void {
    const target = event.target;
    if (target instanceof Element && target.closest('.user-menu, #main-nav, .menu-button')) return;
    menuOpen = false;
    userOpen = false;
  }

  function toggleMode(): void {
    mode = mode === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.mode = mode;
    try { localStorage.setItem('habitloop:mode', mode); } catch { /* Theme still works without storage. */ }
  }
</script>

<svelte:head><title>{app.name}</title><meta name="description" content={app.tagline} /></svelte:head>
<a class="skip" href="#main">Skip to content</a>
<svelte:window onclick={closeMenus} onkeydown={(event) => { if (event.key === 'Escape') { menuOpen = false; userOpen = false; } }} />
{#if data.user}
  <header class="appbar">
    <div class="appbar-inner">
      <button class="icon-btn menu-button" aria-expanded={menuOpen} aria-controls="main-nav" onclick={(event) => { event.stopPropagation(); menuOpen = !menuOpen; }}>
        <Icon name="menu" /><span class="sr-only">Menu</span>
      </button>
      <a class="brand" href="/dashboard"><span class="logo-mark"><Icon name="loop" size={22} /></span><span class="wordmark">{app.name}</span></a>
      <nav id="main-nav" class:menu-open={menuOpen} aria-label="Main navigation">
        {#each nav as item}
          {@const exact = page.url.pathname === item.href}
          {@const section = !exact && item.href !== '/activities/new' && page.url.pathname.startsWith(`${item.href}/`)}
          <a class="nav-link" href={item.href} title={item.label} aria-current={exact ? 'page' : section ? 'true' : undefined} onclick={() => menuOpen = false}>
            <Icon name={item.icon} />
            <span class="nav-label">{item.label}</span>
            {#if item.feature === 'challenges' && community.invites}
              <span class="nav-badge" aria-label={`${community.invites} pending invites`}>{community.invites}</span>
            {:else if item.feature === 'recommendations' && community.recommendations}
              <span class="nav-badge" aria-label={`${community.recommendations} pending recommendations`}>{community.recommendations}</span>
            {/if}
          </a>
        {/each}
      </nav>
      <div class="appbar-actions">
        {#if features.reminders}
          <a class="icon-btn bell" href={model.today.reminders.length ? '#reminders' : '/dashboard'} aria-label={`${model.today.reminders.length} reminders`}>
            <Icon name="bell" />
            {#if model.today.reminders.length}<span class="count-badge" aria-hidden="true">{model.today.reminders.length}</span>{/if}
          </a>
        {/if}
        <button class="icon-btn" onclick={toggleMode} aria-label={`Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`}>
          <Icon name={mode === 'dark' ? 'sun' : 'moon'} />
        </button>
        <div class="user-menu">
          <button class="avatar" aria-label="Account menu" aria-haspopup="true" aria-expanded={userOpen} onclick={(event) => { event.stopPropagation(); userOpen = !userOpen; }}>{initials}</button>
          {#if userOpen}
            <div class="user-panel" role="group" aria-label="Account">
              <p class="user-name">{data.user.name}</p>
              <p class="muted">{data.user.email}</p>
              {#if communityName}<p class="muted">Community: {communityName}</p>{/if}
              <form method="POST" action="/logout"><button type="submit" class="outlined"><Icon name="logout" size={18} />Log out</button></form>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </header>
{:else}
  <button class="icon-btn floating-toggle" onclick={toggleMode} aria-label={`Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`}>
    <Icon name={mode === 'dark' ? 'sun' : 'moon'} />
  </button>
{/if}
<main id="main" class:bare={!data.user}>
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
