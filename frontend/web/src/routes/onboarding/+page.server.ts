import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { User } from '$lib/types';
import { api, ApiError } from '$lib/server/api';
import { setSession } from '$lib/server/session';

export const load: PageServerLoad = ({ locals, url }) => {
  if (locals.user) redirect(303, '/dashboard');
  return { expired: url.searchParams.get('message') === 'expired' };
};

async function authenticate(event: Parameters<Actions[string]>[0], mode: 'register' | 'login') {
  const data = await event.request.formData();
  const values = {
    email: String(data.get('email') ?? '').trim(), name: String(data.get('name') ?? '').trim(),
    timezone: String(data.get('timezone') ?? 'UTC')
  };
  const password = String(data.get('password') ?? '');
  const errors: Record<string, string> = {};
  if (!values.email) errors.email = 'Enter your email.';
  if (!password) errors.password = 'Enter your password.';
  if (mode === 'register' && !values.name) errors.name = 'Enter your name.';
  if (Object.keys(errors).length) return fail(400, { mode, values, errors });
  try {
    const body = mode === 'register' ? { ...values, password } : { email: values.email, password };
    const result = await api<{ token: string; user: User }>(event, `/api/users/${mode}`, { method: 'POST', body: JSON.stringify(body) }, false);
    setSession(event, result.token);
  } catch (cause) {
    if (!(cause instanceof ApiError)) throw cause;
    const errors = { ...cause.fields };
    if (!Object.keys(errors).length) errors[mode === 'login' && cause.status === 401 ? 'password' : mode === 'register' && cause.status === 409 ? 'email' : '_form'] = cause.message;
    return fail(cause.status, { mode, values, errors });
  }
  redirect(303, mode === 'register' ? '/communities?welcome=1' : '/dashboard');
}

export const actions: Actions = {
  register: (event) => authenticate(event, 'register'),
  login: (event) => authenticate(event, 'login')
};
