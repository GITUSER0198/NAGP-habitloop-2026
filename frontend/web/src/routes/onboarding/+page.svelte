<script lang="ts">
  import { enhance } from '$app/forms';
  import { onMount } from 'svelte';
  import type { PageProps } from './$types';
  import type { FieldErrors } from '$lib/types';
  import { app } from '$lib/config/app';
  import Busy from '$lib/components/Busy.svelte';

  let { data, form }: PageProps = $props();
  let mode = $state('register');
  let busy = $state(false);
  let timezone = $state('UTC');
  const errors = $derived((form?.errors ?? {}) as FieldErrors);
  $effect(() => { if (form?.mode) mode = form.mode; });
  onMount(() => { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; });
</script>

<svelte:head><title>Welcome | {app.name}</title></svelte:head>
<section class="onboarding card">
  <p class="eyebrow">{app.name}</p><h1>{app.tagline}</h1>
  <p class="muted">Create your space, choose a habit, and keep your loop going.</p>
  {#if data.expired}<p role="status" class="notice">{app.strings.sessionExpired}</p>{/if}
  <div class="actions" aria-label="Account action">
    <button type="button" class:secondary={mode !== 'register'} aria-pressed={mode === 'register'} onclick={() => mode = 'register'}>Register</button>
    <button type="button" class:secondary={mode !== 'login'} aria-pressed={mode === 'login'} onclick={() => mode = 'login'}>Log in</button>
  </div>
  <form method="POST" action={`?/${mode}`} aria-busy={busy} use:enhance={() => {
    busy = true;
    return async ({ update }) => { try { await update(); } finally { busy = false; } };
  }}>
    <input type="hidden" name="mode" value={mode} /><input type="hidden" name="timezone" value={timezone} />
    {#if errors._form}<p role="alert" class="error">{errors._form}</p>{/if}
    <label for="tenant">{mode === 'register' ? 'Tenant name' : 'Tenant name or slug'}</label>
    <div class="actions"><input id="tenant" name="tenant" required maxlength="200" value={form?.values?.tenant ?? ''} aria-invalid={!!errors.tenant} aria-describedby="tenant-error tenant-message" />
      <button type="submit" formaction="?/tenant" formnovalidate class="secondary" disabled={busy}>Check tenant</button></div>
    <small id="tenant-error" class="error">{errors.tenant ?? ''}</small>
    <p id="tenant-message" class="muted">{form && 'tenantMessage' in form ? form.tenantMessage : 'People in the same tenant share a space. Login is scoped to your tenant.'}</p>
    {#if mode === 'register'}
      <label for="name">Your name</label><input id="name" name="name" required maxlength="200" autocomplete="name" value={form?.values?.name ?? ''} aria-invalid={!!errors.name} aria-describedby="onboarding-name-error" />
      <small id="onboarding-name-error" class="error">{errors.name ?? ''}</small>
    {/if}
    <label for="email">Email</label><input id="email" type="email" name="email" required maxlength="254" autocomplete="email" value={form?.values?.email ?? ''} aria-invalid={!!errors.email} aria-describedby="email-error" />
    <small id="email-error" class="error">{errors.email ?? ''}</small>
    <label for="password">Password</label><input id="password" type="password" name="password" required autocomplete={mode === 'register' ? 'new-password' : 'current-password'} aria-invalid={!!errors.password} aria-describedby="password-error" />
    <small id="password-error" class="error">{errors.password ?? ''}</small>
    {#if errors.timezone}<p class="error" role="alert">{errors.timezone}</p>{/if}
    <button type="submit" disabled={busy}>{busy ? 'Submitting' : mode === 'register' ? 'Create account' : 'Log in'}</button>
    {#if busy}<Busy label="Checking your account" />{/if}
  </form>
</section>
