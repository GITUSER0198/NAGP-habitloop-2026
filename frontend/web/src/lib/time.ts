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

/** "just now", "5m ago", "2h ago", "3d ago", then a short date. */
export function relativeTime(value: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
