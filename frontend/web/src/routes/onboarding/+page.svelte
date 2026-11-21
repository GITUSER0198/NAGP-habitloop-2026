<script lang="ts">
  import { enhance } from '$app/forms';
  import { onMount, untrack } from 'svelte';
  import type { PageProps } from './$types';
  import type { FieldErrors } from '$lib/types';
  import { app } from '$lib/config/app';
  import { rememberCommunity, rememberedCommunity, suggestCommunity } from '$lib/community-name';
  import Busy from '$lib/components/Busy.svelte';
  import Icon from '$lib/components/Icon.svelte';

  let { data, form }: PageProps = $props();
  let mode = $state('register');
  let busy = $state(false);
  let timezone = $state('UTC');
  let community = $state(untrack(() => form?.values?.tenant ?? ''));
  let email = $state(untrack(() => form?.values?.email ?? ''));
  let touched = $state(untrack(() => !!form?.values?.tenant));
  let remembered = $state('');
  const errors = $derived((form?.errors ?? {}) as FieldErrors);
  $effect(() => { if (form?.mode) mode = form.mode; });
  onMount(() => {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    remembered = rememberedCommunity();
    autoFill();
  });

  /** Pre-fill the community until the person edits it: last used one at login, else a guess from the email domain. */
  function autoFill(): void {
    if (touched) return;
    const next = (mode === 'login' ? remembered : '') || suggestCommunity(email);
    if (next) community = next;
  }
  function setMode(next: string): void { mode = next; autoFill(); }
</script>

<svelte:head><title>Welcome | {app.name}</title></svelte:head>
<div class="auth">
  <section class="auth-card">
    <div class="auth-brand"><span class="logo-mark"><Icon name="loop" size={22} /></span>{app.name}</div>
    <h1>{app.tagline}</h1>
    <p class="muted">Join your community, choose a habit, and keep your loop going.</p>
    {#if data.expired}<p role="status" class="notice">{app.strings.sessionExpired}</p>{/if}
    <div class="segmented" role="group" aria-label="Account action">
      <button type="button" aria-pressed={mode === 'register'} onclick={() => setMode('register')}>Register</button>
      <button type="button" aria-pressed={mode === 'login'} onclick={() => setMode('login')}>Log in</button>
    </div>
    <form method="POST" action={`?/${mode}`} aria-busy={busy} use:enhance={() => {
      busy = true;
      const submitted = community;
      return async ({ result, update }) => {
        try {
          if (result.type === 'redirect') rememberCommunity(submitted);
          await update({ reset: false });
        } finally { busy = false; }
      };
    }}>
      <input type="hidden" name="mode" value={mode} /><input type="hidden" name="timezone" value={timezone} />
      {#if errors._form}<p role="alert" class="error">{errors._form}</p>{/if}
      {#if mode === 'register'}
        <label for="name">Your name</label><input id="name" name="name" required maxlength="200" autocomplete="name" value={form?.values?.name ?? ''} aria-invalid={!!errors.name} aria-describedby="onboarding-name-error" />
        <small id="onboarding-name-error" class="error">{errors.name ?? ''}</small>
      {/if}
      <label for="email">Email</label><input id="email" type="email" name="email" required maxlength="254" autocomplete="email" bind:value={email} oninput={autoFill} aria-invalid={!!errors.email} aria-describedby="email-error" />
      <small id="email-error" class="error">{errors.email ?? ''}</small>
      <label for="password">Password</label><input id="password" type="password" name="password" required autocomplete={mode === 'register' ? 'new-password' : 'current-password'} aria-invalid={!!errors.password} aria-describedby="password-error" />
      <small id="password-error" class="error">{errors.password ?? ''}</small>
      <label for="community">{app.strings.communityLabel}</label>
      <div class="actions"><input id="community" name="tenant" required maxlength="200" bind:value={community} oninput={() => { touched = true; }} aria-invalid={!!errors.tenant} aria-describedby="community-error community-message" />
        <button type="submit" formaction="?/community" formnovalidate class="secondary" disabled={busy}>Check community</button></div>
      <small id="community-error" class="error">{errors.tenant ?? ''}</small>
      <p id="community-message" class="muted">{form && 'tenantMessage' in form ? form.tenantMessage : app.strings.communityHint}</p>
      {#if errors.timezone}<p class="error" role="alert">{errors.timezone}</p>{/if}
      <button type="submit" class="wide" disabled={busy}>{busy ? 'Submitting' : mode === 'register' ? 'Create account' : 'Log in'}</button>
      {#if busy}<Busy label="Checking your account" />{/if}
    </form>
  </section>
</div>
