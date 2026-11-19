import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatTime, parseTime } from '../src/lib/time';

test('time inputs normalize supported formats and display AM/PM', () => {
  for (const input of ['21:30', '9:30 PM', '9:30pm']) assert.equal(parseTime(input), '21:30');
  for (const input of ['9pm', '9 PM']) assert.equal(parseTime(input), '21:00');
  assert.equal(parseTime('12am'), '00:00');
  assert.equal(parseTime('12 PM'), '12:00');
  assert.equal(formatTime('00:00'), '12:00 AM');
  assert.equal(formatTime('21:30'), '9:30 PM');
  for (const input of ['', '25:00', '21:60', '0pm', '13pm', '9:3 PM', '-1:30']) assert.equal(parseTime(input), null);
});
