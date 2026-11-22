import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatTime, parseTime, relativeTime } from '../src/lib/time';

test('time inputs normalize supported formats and display AM/PM', () => {
  for (const input of ['21:30', '9:30 PM', '9:30pm']) assert.equal(parseTime(input), '21:30');
  for (const input of ['9pm', '9 PM']) assert.equal(parseTime(input), '21:00');
  assert.equal(parseTime('12am'), '00:00');
  assert.equal(parseTime('12 PM'), '12:00');
  assert.equal(formatTime('00:00'), '12:00 AM');
  assert.equal(formatTime('21:30'), '9:30 PM');
  for (const input of ['', '25:00', '21:60', '0pm', '13pm', '9:3 PM', '-1:30']) assert.equal(parseTime(input), null);
});

test('relative times read as just now, minutes, hours and days ago', () => {
  const now = Date.parse('2026-11-22T12:00:00Z');
  const ago = (ms: number): string => relativeTime(new Date(now - ms).toISOString(), now);
  assert.equal(ago(10_000), 'just now');
  assert.equal(ago(5 * 60_000), '5m ago');
  assert.equal(ago(2 * 3_600_000), '2h ago');
  assert.equal(ago(3 * 86_400_000), '3d ago');
});
