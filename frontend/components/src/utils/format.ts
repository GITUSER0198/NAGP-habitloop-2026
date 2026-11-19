/** Format stored wall-clock time without applying a timezone conversion. */
export function formatTime(value?: string | null): string {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return 'Any time';
  const [hours, minutes] = value.split(':').map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

export function formatDateTime(value?: string): string {
  if (!value) return 'Not yet';
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return formatTime(value);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown date';
  return date.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export function nonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function percentage(current: number, target: number): number {
  return target > 0 ? Math.min(100, Math.max(0, current / target * 100)) : 0;
}
