import { error, fail, type RequestEvent } from '@sveltejs/kit';
import { api, ApiError } from '$lib/server/api';
import { features, type Feature } from '$lib/config/features';

export function requireFeature(feature: Feature): void {
  if (!features[feature]) error(404, 'Not found');
}
export function actionFailure(cause: unknown) {
  if (!(cause instanceof ApiError)) throw cause;
  return fail(cause.status, { message: cause.message, errors: cause.fields });
}
export function field(data: FormData, name: string): string { return String(data.get(name) ?? '').trim(); }
export function resourceId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(400, 'Enter a valid user or resource ID.');
  }
  return encodeURIComponent(value);
}
export async function post<T>(event: RequestEvent, path: string, body: unknown = {}): Promise<T> {
  return api<T>(event, path, { method: 'POST', body: JSON.stringify(body) });
}
