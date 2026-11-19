export function parseTime(value: string): string | null {
  const text = value.trim();
  const clock = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (clock) {
    const hour = Number(clock[1]), minute = Number(clock[2]);
    return hour < 24 && minute < 60 ? `${String(hour).padStart(2, '0')}:${clock[2]}` : null;
  }
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(text);
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2] ?? 0);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  return `${String(hour % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0)).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function formatTime(value: string): string {
  const canonical = parseTime(value);
  if (!canonical) return '';
  const [hour, minute] = canonical.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
  });
}
