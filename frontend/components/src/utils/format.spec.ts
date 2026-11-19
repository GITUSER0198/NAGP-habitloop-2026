import { formatDateTime, formatTime } from './format';

describe('shared time formatting', () => {
  it.each([
    ['00:00', '12:00 AM'], ['12:00', '12:00 PM'], ['09:05', '9:05 AM'],
    ['21:30', '9:30 PM'], ['23:59', '11:59 PM'], [undefined, 'Any time'],
    ['', 'Any time'], ['25:00', 'Any time'], ['9pm', 'Any time'],
  ])('formats %s as %s', (input, expected) => expect(formatTime(input)).toBe(expected));

  it('handles missing, invalid, wall-clock, and timestamp values', () => {
    expect(formatDateTime()).toBe('Not yet');
    expect(formatDateTime('bad')).toBe('Unknown date');
    expect(formatDateTime('21:30')).toBe('9:30 PM');
    expect(formatDateTime('2026-11-19T21:30:00')).toContain('9:30 PM');
  });
});
