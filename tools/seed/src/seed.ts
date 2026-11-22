// Seed the demo through public gateway APIs. Existing demo records are reused.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DAY_MS = 86_400_000;

// A JSON object returned by the gateway; the seed reads only a few known fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped API payloads
type Row = Record<string, any>;

export class HttpError extends Error {
  constructor(readonly code: number) {
    super(`HTTP ${code}`);
  }
}

/** Look a setting up in the environment, then .env, then .env.example (never a built-in default). */
export function setting(name: string, env: NodeJS.ProcessEnv = process.env, root: string = ROOT): string {
  const fromEnv = env[name];
  if (fromEnv !== undefined) return fromEnv;
  for (const filename of ['.env', '.env.example']) {
    const file = path.join(root, filename);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf-8').split(/\r?\n/)) {
      const at = line.indexOf('=');
      if (at >= 0 && line.slice(0, at).trim() === name) {
        return line.slice(at + 1).trim().replace(/^["']+|["']+$/g, '');
      }
    }
  }
  throw new Error(`Set ${name} in the environment or .env`);
}

class API {
  readonly baseUrl: string;
  token = '';

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped API payloads
  async call(method: string, route: string, body?: unknown): Promise<any> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await fetch(this.baseUrl + route, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new HttpError(response.status);
    return response.json();
  }
}

const DEMO_COMMUNITY = 'NAGP Demo';

/** Register (or log in to) an account. Accounts are global and need no community. */
async function account(baseUrl: string, email: string, name: string, password: string): Promise<API> {
  const api = new API(baseUrl);
  let result: Row;
  try {
    result = await api.call('POST', '/api/users/register', { email, name, password, timezone: 'UTC' });
  } catch (error) {
    if (!(error instanceof HttpError) || error.code !== 409) throw error;
    result = await api.call('POST', '/api/users/login', { email, password });
  }
  api.token = result.token;
  return api;
}

/** Make `api` active in the named public community: create it if nobody has, else join it, else switch to it. */
async function enter(api: API, name: string, description: string): Promise<Row> {
  const mine: Row[] = await api.call('GET', '/api/users/communities');
  const own = mine.find((row) => row.name === name && row.kind === 'community');
  if (own !== undefined) {
    const result = await api.call('POST', '/api/users/switch', { community_id: own.id });
    api.token = result.token;
    return result.community as Row;
  }
  const found: Row[] = await api.call('GET', `/api/users/communities/discover?q=${encodeURIComponent(name)}`);
  const existing = found.find((row) => row.name === name);
  const result = existing === undefined
    ? await api.call('POST', '/api/users/communities', { name, description })
    : await api.call('POST', `/api/users/communities/${existing.id}/join`);
  api.token = result.token;
  return result.community as Row;
}

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);
const dateMs = (day: string): number => Date.parse(`${day.slice(0, 10)}T00:00:00Z`);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface PlanItem { api: API; name: string; category: string; hour: number; days: number }

const CHALLENGES_COMMUNITY = 'Nagarro Challenges';
const CHALLENGES_DESCRIPTION = 'Small daily habits we take on together at Nagarro.';
// Joiners, likers and commenters are test user numbers (1 to 3).
const CHALLENGE_POSTS: { title: string; slug: string; category: string; values: string; caption: string; joiners: number[]; likers: number[]; comments: [number, string][] }[] = [
  { title: 'Code Every Day', slug: 'code-every-day', category: 'learning', values: 'Intelligent', joiners: [3], likers: [1],
    caption: 'Write or read code for at least 20 minutes a day. Small steady practice beats weekend cramming.',
    comments: [[1, 'Working through a small Rust exercise each day.']] },
  { title: 'Cycle to Work', slug: 'cycle-to-work', category: 'fitness', values: 'Responsible, Global', joiners: [1, 2], likers: [1, 2, 3],
    caption: 'Swap one commute a day for a bike ride. Fewer emissions, more energy, and a better start to the working day.',
    comments: [[1, 'Day 3 done, the route along the canal is lovely.'], [2, 'Joined! Borrowing a bike this week.']] },
  { title: 'Meditation Streak', slug: 'meditation-streak', category: 'mind', values: 'Client-centric', joiners: [1, 3], likers: [1, 3],
    caption: 'Ten quiet minutes every morning. A calmer head makes for better conversations with clients.',
    comments: [[3, 'Ten minutes before standup works well for me.']] },
  { title: 'Sleep by 11', slug: 'sleep-by-11', category: 'health', values: 'Responsible', joiners: [2], likers: [2, 3],
    caption: 'Lights out by 11 PM. Rested people make better decisions and look after their health.',
    comments: [[2, 'Screens off at 10:30 PM is the trick.'], [3, 'Streak of 5 nights so far.'], [1, 'Trying this from tonight.']] },
  { title: 'Stairs Not Lifts', slug: 'stairs-not-lifts', category: 'fitness', values: 'Agile', joiners: [1, 2, 3], likers: [2],
    caption: 'Take the stairs whenever it is five floors or fewer. Quick, free, and everyone can join in.',
    comments: [[2, 'Seventh floor counts, right?'], [1, 'Legs are feeling it already.']] }
];

/** The Nagarro Challenges community: five posted challenges, joins, likes and comments. Safe to rerun. */
async function seedChallenges(baseUrl: string, password: string): Promise<void> {
  const users = [
    await account(baseUrl, 'dhruv.goel@nagarro.com', 'Dhruv Goel', password),
    await account(baseUrl, 'testuser1@example.com', 'Test User 1', password),
    await account(baseUrl, 'testuser2@example.com', 'Test User 2', password),
    await account(baseUrl, 'testuser3@example.com', 'Test User 3', password)
  ];
  const dhruv = users[0];
  // Registration auto-joins the organization of the email domain (nagarro.com, example.com).
  const organizations = ((await dhruv.call('GET', '/api/users/communities')) as Row[]).filter((row) => row.kind === 'organization');
  console.log(`Organization tenant: ${organizations.map((row) => row.name).join(', ') || 'none'}`);
  await enter(dhruv, CHALLENGES_COMMUNITY, CHALLENGES_DESCRIPTION);
  for (const member of users.slice(1)) await enter(member, CHALLENGES_COMMUNITY, CHALLENGES_DESCRIPTION);
  await enter(dhruv, CHALLENGES_COMMUNITY, CHALLENGES_DESCRIPTION); // last, so it stays Dhruv's last active community
  const feed: Row[] = await dhruv.call('GET', '/api/challenges/feed');
  const start = Date.now() - 6 * DAY_MS;
  for (const [index, item] of CHALLENGE_POSTS.entries()) {
    // Code Every Day is seeded first and starts earliest, so it is last on the newest-first wall and feed.
    const itemStart = index === 0 ? Date.now() - 32 * DAY_MS : start + index * DAY_MS;
    const length = index === 0 ? 60 : 29;
    let challenge: Row | undefined = feed.find((row) => row.title === item.title);
    if (challenge === undefined) {
      challenge = await dhruv.call('POST', '/api/challenges', {
        title: item.title, description: item.caption, visibility: 'public', activity_category: item.category,
        start_date: isoDate(new Date(itemStart)), end_date: isoDate(new Date(itemStart + length * DAY_MS)), target_count: 30,
        image_url: `/posts/${item.slug}.jpg`, caring_value: item.values
      });
    }
    if (String(challenge?.end_date).slice(0, 10) < isoDate(new Date())) continue;
    for (const number of item.joiners) await users[number].call('POST', `/api/challenges/${challenge?.id}/join`);
  }
  // Likes toggle, so only like posts not yet liked; comments are skipped when the same text exists.
  const postIds = new Map<string, string>();
  for (const [index, member] of users.slice(1).entries()) {
    const wall: Row = await member.call('GET', '/api/challenges/wall');
    for (const post of wall.posts as Row[]) {
      postIds.set(post.challenge.title, post.id);
      const item = CHALLENGE_POSTS.find((row) => row.title === post.challenge.title);
      if (item?.likers.includes(index + 1) && !post.liked_by_me) await member.call('POST', `/api/challenges/wall/${post.id}/like`);
    }
  }
  for (const item of CHALLENGE_POSTS) {
    const postId = postIds.get(item.title);
    if (postId === undefined) continue;
    const existing: Row[] = await dhruv.call('GET', `/api/challenges/wall/${postId}/comments`);
    for (const [number, body] of item.comments) {
      if (!existing.some((row) => row.body === body)) await users[number].call('POST', `/api/challenges/wall/${postId}/comments`, { body });
    }
  }
  console.log(`Nagarro Challenges community ready: ${CHALLENGE_POSTS.length} posted challenges`);
}

export async function seed(baseUrl: string): Promise<void> {
  const password = setting('DEMO_PASSWORD');
  const dhruv = await account(baseUrl, 'dhruv.goel@nagarro.com', 'Dhruv Goel', password);
  const user1 = await account(baseUrl, 'testuser1@example.com', 'Test User 1', password);
  const user2 = await account(baseUrl, 'testuser2@example.com', 'Test User 2', password);
  const user3 = await account(baseUrl, 'testuser3@example.com', 'Test User 3', password);
  // Dhruv owns NAGP Demo and everyone joins it. Two more public communities keep Discover populated.
  await enter(user1, 'Morning Runners', 'Early starts, shared miles.');
  await enter(user2, 'Morning Runners', 'Early starts, shared miles.');
  await enter(user3, 'Book Club', 'One chapter a day, together.');
  await enter(dhruv, DEMO_COMMUNITY, 'The NAGP demo community.');
  for (const member of [user1, user2, user3]) await enter(member, DEMO_COMMUNITY, 'The NAGP demo community.');
  console.log('1 of 6: four users and three public communities ready');

  // days: how many of the 30 history days this user logs.
  const plan: PlanItem[] = [
    { api: dhruv, name: 'Morning run', category: 'fitness', hour: 20, days: 30 },
    { api: dhruv, name: 'Read a chapter', category: 'learning', hour: 20, days: 30 },
    { api: user1, name: 'Park walk', category: 'fitness', hour: 7, days: 30 },
    { api: user2, name: 'Evening stretch', category: 'fitness', hour: 18, days: 8 },
    { api: user3, name: 'Evening stretch', category: 'fitness', hour: 18, days: 4 },
  ];
  const activities: Row[] = [];
  for (const item of plan) {
    const existing: Row[] = await item.api.call('GET', '/api/activities');
    let activity = existing.find((row) => row.name === item.name);
    if (activity === undefined) {
      activity = await item.api.call('POST', '/api/activities', {
        name: item.name, category: item.category, frequency: 'daily',
        preferred_time: `${String(item.hour).padStart(2, '0')}:00`, target_per_week: 7,
      });
    }
    activities.push(activity as Row);
  }
  console.log(`2 of 6: ${activities.length} activities ready`);

  const feed: Row[] = await dhruv.call('GET', '/api/challenges/feed');
  const challenges: Row[] = [];
  for (const [title, visibility, category] of [
    ['NAGP 30-day movement', 'public', 'fitness'],
    ['Reading circle', 'members', 'learning'],
  ]) {
    let challenge = feed.find((row) => row.title === title);
    if (challenge === undefined) {
      const now = Date.now();
      challenge = await dhruv.call('POST', '/api/challenges', {
        title, visibility, activity_category: category,
        description: 'Small daily steps, shared encouragement, lasting habits.',
        start_date: isoDate(new Date(now - 30 * DAY_MS)),
        end_date: isoDate(new Date(now + 30 * DAY_MS)), target_count: 30,
      });
    }
    challenges.push(challenge as Row);
  }
  // Do not mutate an ended challenge when reusing an older demo.
  const today = isoDate(new Date());
  if (String(challenges[0].end_date).slice(0, 10) >= today) {
    for (const member of [user1, user2, user3]) {
      await member.call('POST', `/api/challenges/${challenges[0].id}/join`);
    }
  }
  if (String(challenges[1].end_date).slice(0, 10) >= today) {
    await user1.call('POST', `/api/challenges/${challenges[1].id}/join`);
  }
  console.log('3 of 6: public and members-only challenges ready');

  // A stored challenge date anchors the dataset across reruns and interrupted runs.
  const anchor = dateMs(challenges[0].start_date);
  const totalLogs = plan.reduce((sum, item) => sum + item.days, 0);
  let added = 0;
  let step = 0;
  for (let activityIndex = 0; activityIndex < plan.length; activityIndex += 1) {
    const { api, days } = plan[activityIndex];
    const activity = activities[activityIndex];
    const route = `/api/activities/${activity.id}/logs`;
    const existingRows: Row[] = await api.call('GET', route);
    const existingTimes = new Set(existingRows.map((row) => new Date(row.logged_at).getTime()));
    const alwaysFixed = activity.name === 'Park walk' || activity.name === 'Evening stretch';
    for (let index = 0; index < days; index += 1) {
      const morning = index % 2 === 0 || alwaysFixed;
      const hour = activity.name === 'Evening stretch' ? 18 : morning ? 7 : 20;
      const stamp = anchor + index * DAY_MS + hour * 3_600_000;
      const status = morning ? 'completed' : index % 5 === 0 ? 'done' : 'missed';
      if (!existingTimes.has(stamp)) {
        await api.call('POST', route, {
          status, logged_at: new Date(stamp).toISOString(), duration_min: status === 'completed' ? 25 : 5,
        });
        added += 1;
      }
      step += 1;
      console.log(`4 of 6: history ${step} of ${totalLogs}`);
    }
  }
  console.log(`4 of 6: history ready, ${added} logs added`);

  const links: Row[] = await dhruv.call('GET', '/api/integrations/links');
  const runId = activities[0].id;
  if (!links.some((row) => row.provider === 'mockfit' && row.activity_map?.run === runId)) {
    await dhruv.call('POST', '/api/integrations/links', { provider: 'mockfit', activity_map: { run: runId } });
  }
  console.log('5 of 6: mockfit link ready');

  const deadline = Date.now() + 90_000;
  await waitForTiming(dhruv, activities, deadline);
  await seedChallenges(baseUrl, password);
}

async function waitForTiming(dhruv: API, activities: Row[], deadline: number): Promise<void> {
  for (;;) {
    const result = await dhruv.call('POST', '/api/recommendations/refresh');
    const timing: Row[] = (result.recommendations as Row[]).filter((row) => row.kind === 'timing');
    if (timing.length > 0) {
      console.log(`6 of 6: ${timing.length} timing suggestions ready. Demo finished.`);
      return;
    }
    if (activities.slice(0, 2).every((row) => row.preferred_time === '07:00')) {
      console.log('6 of 6: morning schedules already applied');
      return;
    }
    if (Date.now() >= deadline) throw new Error('Timed out waiting for a timing suggestion from seeded analytics');
    console.log('6 of 6: waiting for analytics and timing suggestion');
    await sleep(2000);
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { 'base-url': { type: 'string', default: process.env.BASE_URL ?? 'http://localhost:47810' } },
  });
  try {
    await seed(values['base-url'] as string);
  } catch (error) {
    const reason = error instanceof HttpError ? `HTTP ${error.code}` : error instanceof Error ? error.message : String(error);
    console.error(`FAIL: seed: ${reason}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
