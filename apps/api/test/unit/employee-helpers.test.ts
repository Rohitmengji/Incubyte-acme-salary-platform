import { describe, expect, it } from 'vitest';
import { escapeLike } from '../../src/modules/employees/employee.service.ts';
import { diff } from '../../src/modules/audit/audit.ts';

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
    expect(escapeLike('Priya')).toBe('Priya');
  });
});

describe('diff', () => {
  it('returns only changed keys, or null when nothing changed', () => {
    expect(diff({ a: 1, b: 'x', c: null }, { a: 2, b: 'x', c: null })).toEqual({
      before: { a: 1 },
      after: { a: 2 },
    });
    expect(diff({ a: 1 }, { a: 1 })).toBeNull();
  });
});
