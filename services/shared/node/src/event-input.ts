// Python UUID accepts compact, braced and URN forms as well as canonical UUIDs.
export function eventUuid(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${field}`);
  const hex = value.replace('urn:', '').replace('uuid:', '').replace(/^\{+|\}+$/g, '').replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`Invalid ${field}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toLowerCase();
}

// Validate calendar fields explicitly: Date.parse silently rolls invalid days forward.
export function eventTimestamp(value: unknown, invalid: string, naive: string): { date: Date; iso: string } {
  if (typeof value !== 'string') throw new Error(invalid);
  const calendar = /^(\d{4})(-?)(\d{2})\2(\d{2})/.exec(value);
  const week = /^(\d{4})(-?)W(\d{2})(?:\2([1-7]))?/.exec(value);
  let datePart: string;
  let rest: string;
  if (calendar) {
    datePart = `${calendar[1]}-${calendar[3]}-${calendar[4]}`;
    rest = value.slice(calendar[0].length);
  } else if (week) {
    const year = Number(week[1]); const number = Number(week[3]);
    const jan4 = new Date(`${week[1]}-01-04T00:00:00Z`);
    if (!year || number < 1 || number > 53) throw new Error(invalid);
    const monday = new Date(jan4);
    monday.setUTCDate(4 - ((jan4.getUTCDay() + 6) % 7) + (number - 1) * 7);
    const thursday = new Date(monday); thursday.setUTCDate(thursday.getUTCDate() + 3);
    if (thursday.getUTCFullYear() !== year) throw new Error(invalid);
    monday.setUTCDate(monday.getUTCDate() + Number(week[4] ?? 1) - 1);
    datePart = monday.toISOString().slice(0, 10);
    rest = value.slice(week[0].length);
  } else throw new Error(invalid);
  // fromisoformat permits a single separator, including a space, and basic ISO forms.
  const time = rest ? Array.from(rest).slice(1).join('') : '00';
  const match = /^(\d{2})(?:(:?)(\d{2})(?:\2(\d{2}))?)?(?:[.,](\d+))?(Z|[+-]\d{2}(?:(:?)(\d{2})(?:\7(\d{2}))?)?(?:[.,](\d+))?)?$/.exec(time);
  if (!match) throw new Error(invalid);
  const [, hour, , minute = '00', second = '00', fraction = '', zone, , offsetMinute = '00', offsetSecond = '00', offsetFraction = ''] = match;
  const base = `${datePart}T${hour}:${minute}:${second}`;
  const local = new Date(`${base}.000Z`);
  if (Number(datePart.slice(0, 4)) < 1 || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      Number.isNaN(local.getTime()) || local.toISOString().slice(0, 19) !== base) throw new Error(invalid);
  if (!zone) throw new Error(naive);
  const offsetSeconds = zone === 'Z' ? 0 : Number(zone.slice(1, 3)) * 3600 + Number(offsetMinute) * 60 + Number(offsetSecond);
  const offsetMicros = offsetSeconds ? Number(offsetFraction.slice(0, 6).padEnd(6, '0')) : 0;
  if (offsetSeconds >= 86_400) throw new Error(invalid);
  const adjustment = Number(fraction.slice(0, 6).padEnd(6, '0')) - (zone.startsWith('-') ? -1 : 1) * (offsetSeconds * 1_000_000 + offsetMicros);
  const date = new Date(local.getTime() + Math.floor(adjustment / 1000));
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) throw new Error(invalid);
  const micros = date.getUTCMilliseconds() * 1000 + ((adjustment % 1000) + 1000) % 1000;
  return { date, iso: `${date.toISOString().slice(0, 19)}${micros ? `.${String(micros).padStart(6, '0')}` : ''}+00:00` };
}
