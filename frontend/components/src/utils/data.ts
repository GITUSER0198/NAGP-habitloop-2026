export type JsonArray<T> = T[] | string;
export interface ChartPoint { label: string; value: number }
export interface HeatmapDay { date: string; done: number; completed: number; missed: number }
export interface LeaderboardRow { name: string; count: number; target: number; isMe: boolean }
export interface ReminderItem { activityId: string; name: string; dueAt: string }

export function parseArray(value: unknown): unknown[] {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function chartPoints(value: unknown): ChartPoint[] {
  const input = parseArray(value);
  const points: ChartPoint[] = [];
  for (const [index, item] of input.entries()) {
    if (count(item)) points.push({ label: String(index + 1), value: item });
    else if (record(item) && typeof item.label === 'string' && count(item.value)) {
      points.push({ label: item.label, value: item.value });
    } else return [];
  }
  return points;
}

export function heatmapDays(value: unknown): HeatmapDay[] {
  const days = new Map<string, HeatmapDay>();
  for (const item of parseArray(value)) {
    if (!record(item) || typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)
      || !Number.isFinite(Date.parse(`${item.date}T00:00:00Z`))
      || new Date(`${item.date}T00:00:00Z`).toISOString().slice(0, 10) !== item.date
      || !count(item.done) || !count(item.completed) || !count(item.missed)) return [];
    days.set(item.date, { date: item.date, done: item.done, completed: item.completed, missed: item.missed });
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Last 365 UTC calendar dates ending on the latest supplied date. */
export function yearGrid(days: HeatmapDay[]): (HeatmapDay | null)[] {
  if (!days.length) return [];
  const end = new Date(`${days[days.length - 1].date}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 364);
  const cells: (HeatmapDay | null)[] = Array.from({ length: start.getUTCDay() }, () => null);
  const lookup = new Map(days.map(day => [day.date, day]));
  for (let offset = 0; offset < 365; offset++) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + offset);
    const key = date.toISOString().slice(0, 10);
    cells.push(lookup.get(key) ?? { date: key, done: 0, completed: 0, missed: 0 });
  }
  return cells;
}
