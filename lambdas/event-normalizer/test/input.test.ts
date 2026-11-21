import { describe, expect, it } from 'vitest';
import { eventTimestamp, eventUuid } from '@habitloop/shared/event-input';
import pythonTimestamps from './python-timestamps.json';

describe('event input compatibility with Python', () => {
  // Captured from datetime.fromisoformat in the existing Python service image.
  it.each(pythonTimestamps)('parses $value', scenario => {
    const parse = () => eventTimestamp(scenario.value, 'invalid', 'naive');
    if ('error' in scenario) expect(parse).toThrow(scenario.error);
    else expect(parse().iso).toBe(scenario.iso);
  });

  it.each(['00000000-0000-0000-0000-000000000000', 'ABCDEFABCDEF0ABC0ABCABCDEFABCDEF', '{abcdefab-cdef-0abc-0abc-abcdefabcdef}', 'urn:uuid:abcdefab-cdef-0abc-0abc-abcdefabcdef'])('accepts UUID form %s', value => {
    expect(eventUuid(value, 'id')).toBe(value.startsWith('0000') ? value : 'abcdefab-cdef-0abc-0abc-abcdefabcdef');
  });
});
