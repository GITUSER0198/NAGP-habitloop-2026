const PUBLIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'yahoo.com', 'hotmail.com', 'icloud.com', 'live.com', 'msn.com',
  'aol.com', 'proton.me', 'protonmail.com', 'me.com'
]);

/** Suggest a community name from an email address, or '' for public or incomplete addresses. */
export function suggestCommunity(email: string): string {
  const match = /^[^@\s]+@([^@\s]+\.[^@\s]+)$/.exec(email.trim().toLowerCase());
  if (!match) return '';
  const domain = match[1];
  if (PUBLIC_DOMAINS.has(domain)) return '';
  const labels = domain.split('.');
  const generic = new Set(['co', 'com', 'org', 'net', 'edu', 'gov', 'ac']);
  let index = labels.length - 2;
  if (index > 0 && labels[labels.length - 1].length === 2 && generic.has(labels[index])) index -= 1;
  const name = labels[index].replace(/[^a-z0-9]+/g, ' ').trim();
  return name ? name.replace(/\b[a-z]/g, letter => letter.toUpperCase()) : '';
}

export const COMMUNITY_KEY = 'habitloop:community';

export function rememberedCommunity(): string {
  try { return localStorage.getItem(COMMUNITY_KEY) ?? ''; } catch { return ''; }
}

export function rememberCommunity(value: string): void {
  try { if (value.trim()) localStorage.setItem(COMMUNITY_KEY, value.trim()); } catch { /* Storage is optional. */ }
}
