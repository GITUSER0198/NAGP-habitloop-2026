import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { SignJWT } from 'jose';

if (!process.env.PLAYWRIGHT_MODULE || !process.env.WEB_URL || !process.env.GATEWAY_URL) {
  throw new Error('Set PLAYWRIGHT_MODULE, WEB_URL and GATEWAY_URL to test the running stack.');
}
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
const web = process.env.WEB_URL;
const gateway = process.env.GATEWAY_URL;
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge', headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const suffix = randomUUID().slice(0, 8);
const tenant = `Web check ${suffix}`;
const email = `web-${suffix}@example.com`;
const password = randomUUID();
const activityName = `Walk ${suffix}`;

async function until(check, label, timeout = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out: ${label}`);
}
async function api(path, body, token) {
  const response = await fetch(`${gateway}${path}`, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  assert.ok(response.ok, `${path}: ${response.status}`);
  return response.json();
}

try {
  console.log('1 of 8: register, tenant check and cookie');
  await page.goto(`${web}/onboarding`);
  await page.waitForFunction(() => !!customElements.get('hl-chart'));
  await page.getByLabel('Tenant name', { exact: true }).fill(tenant);
  await page.getByRole('button', { name: 'Check tenant', exact: true }).click();
  await page.getByText('A new tenant will be created when you register.').waitFor();
  await page.getByLabel('Your name', { exact: true }).fill('Web acceptance');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.waitForURL('**/dashboard');
  const cookie = (await context.cookies()).find(item => item.name === 'habitloop_session');
  assert.ok(cookie?.httpOnly);
  assert.equal(await page.evaluate(() => document.cookie.includes('habitloop_session')), false);

  console.log('2 of 8: create activity, time parsing and category picker');
  await page.getByRole('link', { name: 'New activity', exact: true }).first().click();
  await page.getByLabel('Activity name', { exact: true }).fill(activityName);
  await page.getByLabel('fitness', { exact: true }).check();
  await page.getByLabel('Frequency', { exact: true }).selectOption('custom');
  await page.getByRole('button', { name: 'Create activity', exact: true }).click();
  await page.getByText('Choose at least one day.').waitFor();
  await page.getByLabel('Monday', { exact: true }).check();
  await page.getByLabel('Frequency', { exact: true }).selectOption('daily');
  await page.getByLabel('Preferred time', { exact: true }).fill('9pm');
  await page.getByLabel('Preferred time', { exact: true }).blur();
  assert.equal(await page.getByLabel('Preferred time', { exact: true }).inputValue(), '9:00 PM');
  await page.getByRole('button', { name: 'Create activity', exact: true }).click();
  await page.waitForURL(/\/activities\/[a-f0-9-]+\?created=1$/);
  const activityId = new URL(page.url()).pathname.split('/').at(-1);
  await page.getByLabel('Preferred time', { exact: true }).fill('12am');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByText('Activity saved.', { exact: true }).first().waitFor();
  await page.getByRole('link', { name: 'Back to dashboard', exact: true }).click();
  await page.waitForURL('**/dashboard');
  await page.locator('hl-activity-summary').getByRole('button', { name: 'Log done', exact: true }).waitFor();
  await page.locator('hl-reminder-banner').getByRole('button', { name: 'Snooze', exact: true }).click();
  await until(async () => await page.locator('hl-reminder-banner').count() === 0, 'snoozed reminder hidden');
  await page.reload();
  await page.waitForFunction(() => !!customElements.get('hl-chart'));
  await page.getByRole('link', { name: '0 reminders', exact: true }).waitFor();
  assert.equal(await page.locator('hl-reminder-banner').count(), 0);
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage).filter(key => key.startsWith('habitloop:snoozes:'))) {
      const saved = JSON.parse(localStorage.getItem(key));
      for (const id of Object.keys(saved)) saved[id] = Date.now() - 1;
      localStorage.setItem(key, JSON.stringify(saved));
    }
  });
  await page.reload();
  await page.locator('hl-reminder-banner').getByRole('button', { name: 'Log now', exact: true }).waitFor();

  console.log('3 of 8: log done, SSE summary and no document reload');
  await page.evaluate(() => { window.habitloopAcceptance = 'same document'; });
  await page.locator('hl-reminder-banner').getByRole('button', { name: 'Log now', exact: true }).click();
  await until(async () => await page.getByTestId('summary-done').textContent() === '1', 'live summary = 1');
  assert.equal(await page.evaluate(() => window.habitloopAcceptance), 'same document');
  await page.getByText('Live updates connected', { exact: true }).waitFor();
  await until(async () => await page.locator('hl-reminder-banner').count() === 0, 'logged reminder hidden');

  console.log('4 of 8: wearable event refreshes dashboard without reload');
  const token = cookie.value;
  const link = await api('/api/integrations/links', { provider: 'mockfit', activity_map: { run: activityId } }, token);
  const payload = JSON.stringify({ event_id: `web-wearable-${suffix}`, type: 'workout', started_at: new Date().toISOString(), duration_min: 30, provider_activity: 'run' });
  const signingKey = createHash('sha256').update(link.ingest_key).digest();
  const signature = `sha256=${createHmac('sha256', signingKey).update(payload).digest('hex')}`;
  const ingest = await fetch(`${gateway}/api/integrations/ingest/${link.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HabitLoop-Signature': signature }, body: payload });
  assert.equal(ingest.status, 202);
  await until(async () => {
    const snapshot = await api('/api/analytics/summary', undefined, token);
    return snapshot.today.done + snapshot.today.completed === 2;
  }, 'wearable analytics');
  await until(async () => Number(await page.getByTestId('summary-done').textContent())
    + Number(await page.locator('dd').nth(1).textContent()) === 2, 'wearable UI summary');
  assert.equal(await page.evaluate(() => window.habitloopAcceptance), 'same document');
  await page.locator('hl-activity-summary').getByRole('button', { name: 'Log completed', exact: true }).click();
  await until(async () => Number(await page.getByTestId('summary-done').textContent())
    + Number(await page.locator('dd').nth(1).textContent()) === 3, 'completed status summary');
  await page.locator('hl-activity-summary').getByRole('button', { name: 'Log missed', exact: true }).click();
  await until(async () => await page.locator('dd').nth(2).textContent() === '1', 'missed status summary');
  await until(async () => await page.locator('hl-heatmap').evaluate(element => {
    const data = typeof element.data === 'string' ? JSON.parse(element.data) : element.data;
    return data.some(day => day.done + day.completed === 3 && day.missed === 1);
  }), 'heatmap also refreshed');
  assert.equal(await page.evaluate(() => window.habitloopAcceptance), 'same document');

  console.log('5 of 8: SSE failure falls back to polling; analytics unavailable UI keeps activities');
  await page.route('**/api/analytics/stream', route => route.abort());
  await page.reload();
  await page.getByText('Polling every 10 seconds', { exact: true }).waitFor();
  await page.route('**/api/dashboard', async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, summary: null, trend: null, heatmap: null, milestones: null } });
  });
  await until(async () => await page.getByText('Unavailable: analytics could not be reached.', { exact: true }).isVisible(), 'analytics unavailable panel', 18000);
  assert.ok(await page.locator('hl-activity-summary').getByRole('button', { name: 'Log done', exact: true }).isVisible());
  await page.unroute('**/api/dashboard');
  await page.unroute('**/api/analytics/stream');

  console.log('6 of 8: theme, mobile navigation, login and logout');
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('data-mode'), 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  assert.ok(await page.getByRole('navigation', { name: 'Main navigation' }).isVisible());
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('.user-menu > summary').click();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await page.waitForURL('**/onboarding');
  await page.getByRole('button', { name: 'Log in', exact: true }).first().click();
  await page.getByLabel('Tenant name or slug', { exact: true }).fill(tenant);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).last().click();
  await page.waitForURL('**/dashboard');

  console.log('7 of 8: cross-tenant activity is hidden and returns 404');
  const otherContext = await browser.newContext();
  const other = await api('/api/users/register', { tenant_name: `Other ${suffix}`, name: 'Other tenant', email, password });
  await otherContext.addCookies([{ name: 'habitloop_session', value: other.token, url: web, httpOnly: true, sameSite: 'Lax' }]);
  const otherPage = await otherContext.newPage();
  await otherPage.goto(`${web}/dashboard`);
  assert.equal(await otherPage.locator('hl-activity-summary').count(), 0);
  const forbidden = await otherContext.request.get(`${web}/activities/${activityId}`);
  assert.equal(forbidden.status(), 404);
  assert.equal((await otherContext.request.get(`${web}/api/analytics/cohorts`)).status(), 404);
  await otherContext.close();

  console.log('8 of 8: expired JWT redirects with a message');
  const envText = await readFile(new URL('../../../.env', import.meta.url), 'utf8');
  const secret = process.env.JWT_SECRET ?? envText.split(/\r?\n/).find(line => line.startsWith('JWT_SECRET='))?.slice('JWT_SECRET='.length).replace(/^['"]|['"]$/g, '');
  assert.ok(secret, 'JWT_SECRET exists for expiry test');
  const expired = await new SignJWT({ tenant_id: other.user.tenant_id, email, name: 'Expired' }).setProtectedHeader({ alg: 'HS256' }).setSubject(other.user.id).setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(new TextEncoder().encode(secret));
  await context.addCookies([{ name: 'habitloop_session', value: expired, url: web, httpOnly: true, sameSite: 'Lax' }]);
  await page.goto(`${web}/dashboard`);
  await page.waitForURL('**/onboarding?message=expired');
  await page.getByText('Your session expired. Please log in again.', { exact: true }).waitFor();
  assert.deepEqual(errors, [], `Browser errors: ${errors.join(', ')}`);
  console.log('PASS: web walkthrough, live wearable update, polling, tenant isolation and expiry.');
} catch (cause) {
  console.error('Browser errors:', errors);
  throw cause;
} finally { await context.close(); await browser.close(); }
