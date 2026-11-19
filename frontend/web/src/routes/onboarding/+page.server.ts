import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { User } from '$lib/types';
import { api, ApiError, COOKIE } from '$lib/server/api';
import { decodeJwt } from 'jose';

function slug(value: string): string {
  return value.normalize('NFKD').replace(/[^\x00-\x7F]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export const load: PageServerLoad = ({ locals, url }) => {
  if (locals.user) redirect(303, '/dashboard');
  return { expired: url.searchParams.get('message') === 'expired' };
};

async function authenticate(event: Parameters<Actions[string]>[0], mode: 'register' | 'login') {
  const data = await event.request.formData();
  const values = {
    tenant: String(data.get('tenant') ?? '').trim(), email: String(data.get('email') ?? '').trim(),
    name: String(data.get('name') ?? '').trim(), timezone: String(data.get('timezone') ?? 'UTC')
  };
  const password = String(data.get('password') ?? '');
  const errors: Record<string, string> = {};
  if (!slug(values.tenant)) errors.tenant = 'Enter a tenant name using letters or numbers.';
  if (!values.email) errors.email = 'Enter your email.';
  if (!password) errors.password = 'Enter your password.';
  if (mode === 'register' && !values.name) errors.name = 'Enter your name.';
  if (Object.keys(errors).length) return fail(400, { mode, values, errors });
  try {
    const tenant = await api<{ exists: boolean; name: string | null }>(event, `/api/users/tenants/${encodeURIComponent(slug(values.tenant))}`, {}, false);
    if (mode === 'login' && !tenant.exists) return fail(400, { mode, values, errors: { tenant: 'This tenant does not exist. Register to create it.' } });
    const body = mode === 'register'
      ? { ...values, tenant: undefined, tenant_name: values.tenant, password }
      : { tenant_slug: slug(values.tenant), email: values.email, password };
    const result = await api<{ token: string; user: User }>(event, `/api/users/${mode}`, { method: 'POST', body: JSON.stringify(body) }, false);
    const expires = decodeJwt(result.token).exp;
    event.cookies.set(COOKIE, result.token, {
      path: '/', httpOnly: true, secure: event.url.protocol === 'https:', sameSite: 'lax',
      maxAge: expires ? Math.max(0, expires - Math.floor(Date.now() / 1000)) : 3600
    });
  } catch (cause) {
    if (!(cause instanceof ApiError)) throw cause;
    const errors = { ...cause.fields };
    if (errors.tenant_name || errors.tenant_slug) errors.tenant = errors.tenant_name ?? errors.tenant_slug;
    if (!Object.keys(errors).length) errors[mode === 'login' && cause.status === 401 ? 'password' : '_form'] = cause.message;
    return fail(cause.status, { mode, values, errors });
  }
  redirect(303, '/dashboard');
}

export const actions: Actions = {
  register: (event) => authenticate(event, 'register'),
  login: (event) => authenticate(event, 'login'),
  tenant: async (event) => {
    const data = await event.request.formData();
    const values = { tenant: String(data.get('tenant') ?? '').trim(), email: String(data.get('email') ?? ''), name: String(data.get('name') ?? ''), timezone: String(data.get('timezone') ?? 'UTC') };
    const mode = data.get('mode') === 'login' ? 'login' : 'register';
    if (!slug(values.tenant)) return fail(400, { mode, values, errors: { tenant: 'Enter a tenant name using letters or numbers.' } });
    try {
      const tenant = await api<{ exists: boolean; name: string | null }>(event, `/api/users/tenants/${encodeURIComponent(slug(values.tenant))}`, {}, false);
      return { mode, values, errors: {}, tenantMessage: tenant.exists ? `You will join ${tenant.name}.` : 'A new tenant will be created when you register.' };
    } catch (cause) {
      if (!(cause instanceof ApiError)) throw cause;
      return fail(cause.status, { mode, values, errors: { tenant: cause.message } });
    }
  }
};
