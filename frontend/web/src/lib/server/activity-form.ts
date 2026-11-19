import { fail, type RequestEvent } from '@sveltejs/kit';
import type { Activity, ActivityValues, FieldErrors, Status } from '$lib/types';
import { parseTime, formatTime } from '$lib/time';
import { features } from '$lib/config/features';
import { api, ApiError } from './api';

export async function saveActivity(event: RequestEvent, id?: string) {
  const data = await event.request.formData();
  const rawDays = data.getAll('days_of_week').map(String);
  const values: ActivityValues = {
    name: String(data.get('name') ?? '').trim(), category: features.categories ? String(data.get('category') ?? '') : 'other',
    frequency: String(data.get('frequency') ?? ''), days_of_week: rawDays.map(Number),
    preferred_time: String(data.get('preferred_time') ?? ''), target_per_week: String(data.get('target_per_week') ?? '')
  };
  const errors: FieldErrors = {};
  const time = parseTime(values.preferred_time);
  if (!values.name || values.name.length > 200) errors.name = 'Use a name between 1 and 200 characters.';
  if (!time) errors.preferred_time = 'Enter a time such as 9:30 PM.';
  else values.preferred_time = formatTime(time);
  if (!['daily', 'weekly', 'custom'].includes(values.frequency)) errors.frequency = 'Choose a valid frequency.';
  if (rawDays.some(day => !/^[0-6]$/.test(day))) errors.days_of_week = 'Choose valid days from Monday to Sunday.';
  if (values.frequency !== 'daily' && !rawDays.length) errors.days_of_week = 'Choose at least one day.';
  if (!/^[1-7]$/.test(values.target_per_week)) errors.target_per_week = 'Choose a target from 1 to 7.';
  if (Object.keys(errors).length) return fail(400, { values, errors });
  try {
    const categories = await api<Record<string, string>>(event, '/api/activities/categories');
    if (!Object.hasOwn(categories, values.category)) return fail(400, { values, errors: { category: 'Choose a configured category.' } });
    const activity = await api<Activity>(event, `/api/activities${id ? `/${encodeURIComponent(id)}` : ''}`, {
      method: id ? 'PATCH' : 'POST', body: JSON.stringify({
        ...values, preferred_time: time, days_of_week: [...new Set(values.days_of_week)], target_per_week: Number(values.target_per_week)
      })
    });
    return { activity, values, errors: {}, saved: true };
  } catch (cause) {
    if (!(cause instanceof ApiError)) throw cause;
    return fail(cause.status, { values, errors: Object.keys(cause.fields).length ? cause.fields : { _form: cause.message } });
  }
}

export async function logActivity(event: RequestEvent, id: string) {
  const data = await event.request.formData();
  const status = String(data.get('status') ?? '') as Status;
  if (!['done', 'completed', 'missed'].includes(status)) return fail(400, { logErrors: { status: 'Choose done, completed, or missed.' } });
  try {
    await api(event, `/api/activities/${encodeURIComponent(id)}/logs`, { method: 'POST', body: JSON.stringify({ status }) });
    return { logged: true, status };
  } catch (cause) {
    if (!(cause instanceof ApiError)) throw cause;
    return fail(cause.status, { logErrors: { status: cause.message } });
  }
}
