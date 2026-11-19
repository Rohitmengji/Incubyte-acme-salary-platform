import { describe, expect, it } from 'vitest';
import { amountSchema, decimalPlaces, fitsCurrencyScale } from './money.ts';
import { isIsoCalendarDate, isoDateSchema, utcToday } from './dates.ts';
import { employeeListQuerySchema, updateEmployeeRequestSchema } from './schemas.ts';

describe('amountSchema', () => {
  it.each(['85000', '85000.5', '85000.50', '0.01', '123456789012345.1234'])(
    'accepts %s',
    (value) => {
      expect(amountSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each([
    ['1,200,000', 'thousands separators'],
    ['$85000', 'currency symbols'],
    ['-10', 'negative amounts'],
    ['0', 'zero'],
    ['0.00', 'zero with decimals'],
    ['1e6', 'exponent notation'],
    ['85000.12345', 'more than 4 decimals'],
    ['0085000', 'leading zeros'],
    ['1234567890123456', 'more than 15 integer digits'],
  ])('rejects %s (%s)', (value) => {
    expect(amountSchema.safeParse(value).success).toBe(false);
  });
});

describe('currency scale', () => {
  it('counts decimal places', () => {
    expect(decimalPlaces('100')).toBe(0);
    expect(decimalPlaces('100.5')).toBe(1);
    expect(decimalPlaces('100.50')).toBe(2);
  });

  it('enforces minor units per currency', () => {
    expect(fitsCurrencyScale('9800000', 0)).toBe(true); // JPY
    expect(fitsCurrencyScale('9800000.5', 0)).toBe(false); // JPY has no minor unit
    expect(fitsCurrencyScale('85000.50', 2)).toBe(true); // USD
    expect(fitsCurrencyScale('85000.505', 2)).toBe(false);
  });
});

describe('dates', () => {
  it('validates real calendar dates only', () => {
    expect(isIsoCalendarDate('2024-02-29')).toBe(true);
    expect(isIsoCalendarDate('2025-02-29')).toBe(false);
    expect(isIsoCalendarDate('2026-04-31')).toBe(false);
    expect(isIsoCalendarDate('2026-4-1')).toBe(false);
    expect(isoDateSchema.safeParse('1899-12-31').success).toBe(false);
  });

  it('derives today in UTC, not local time', () => {
    // 00:30 in India (UTC+5:30) on 20 Nov is still 19 Nov in UTC.
    expect(utcToday(new Date('2026-11-19T19:00:00Z'))).toBe('2026-11-19');
  });
});

describe('employeeListQuerySchema', () => {
  it('applies defaults', () => {
    expect(employeeListQuerySchema.parse({})).toMatchObject({
      sort: 'name',
      order: 'asc',
      page: 1,
      pageSize: 25,
    });
  });

  it('accepts repeated and comma-separated filters and normalises codes', () => {
    const parsed = employeeListQuerySchema.parse({
      country: ['us', 'IN,gb'],
      department: '1,2',
      status: 'ACTIVE',
    });
    expect(parsed.country).toEqual(['US', 'IN', 'GB']);
    expect(parsed.department).toEqual([1, 2]);
    expect(parsed.status).toEqual(['ACTIVE']);
  });

  it('caps page size and rejects unknown sort fields', () => {
    expect(employeeListQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
    expect(employeeListQuerySchema.safeParse({ sort: 'salary' }).success).toBe(false);
  });
});

describe('updateEmployeeRequestSchema', () => {
  it('requires at least one change besides version', () => {
    expect(updateEmployeeRequestSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateEmployeeRequestSchema.safeParse({ version: 1, firstName: 'Asha' }).success).toBe(
      true,
    );
  });

  it('does not allow changing the immutable employee code or setting INACTIVE directly', () => {
    expect(updateEmployeeRequestSchema.safeParse({ version: 1, employeeCode: 'X-1' }).success).toBe(
      false,
    );
    expect(updateEmployeeRequestSchema.safeParse({ version: 1, status: 'INACTIVE' }).success).toBe(
      false,
    );
  });
});

describe('reference pickers', () => {
  it('asks for a choice when a department or job title select is left on its placeholder', () => {
    const result = updateEmployeeRequestSchema.safeParse({ version: 1, departmentId: '' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ['departmentId'],
      message: 'Please choose an option',
    });
  });
});
