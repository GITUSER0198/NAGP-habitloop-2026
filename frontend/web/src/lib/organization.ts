// Mirrors the User Service rule: a non-public email domain is the organization (tenant); public mail providers get none.
const PUBLIC_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'proton.me', 'protonmail.com'
]);

export function emailDomain(email: string): string {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf('@');
  const domain = at < 0 ? '' : value.slice(at + 1);
  return /^[^\s@]+\.[^\s@]+$/.test(domain) ? domain : '';
}

/** What the register page shows in the read-only Tenant field. */
export function tenantLabel(email: string): string {
  const domain = emailDomain(email);
  if (!domain) return '';
  return PUBLIC_DOMAINS.has(domain) ? 'Personal account (public email domain)' : domain;
}
