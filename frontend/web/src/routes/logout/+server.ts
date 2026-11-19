import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { COOKIE } from '$lib/server/api';

export const POST: RequestHandler = ({ cookies }) => {
  cookies.delete(COOKIE, { path: '/' });
  redirect(303, '/onboarding');
};
