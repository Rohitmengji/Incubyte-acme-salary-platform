import { describe, expect, it } from 'vitest';
import { formatDate, formatMoney, tenure } from '@/lib/format';
import { safeNextPath } from '@/features/auth/login-form';
import {
  parseEmployeeQuery,
  serializeEmployeeQuery,
} from '@/features/employees/use-employee-query';
import { buildCorrection } from '@/features/compensation/correction-dialog';
import type { CompensationRecord } from '@acme/shared';

// Intl puts a non-breaking space between the currency code and the amount (keeps them on one line).
const NBSP = '\u00a0';

describe('formatMoney', () => {
  it('formats the decimal string exactly, beyond float precision', () => {
    // As a JS number this value would round to 1,000,000,000,000,000.00.
    expect(formatMoney('999999999999999.99', 'USD')).toBe(`USD${NBSP}999,999,999,999,999.99`);
  });

  it('shows the decimals the server sent: none for JPY, two for USD', () => {
    expect(formatMoney('9800000', 'JPY')).toBe(`JPY${NBSP}9,800,000`);
    expect(formatMoney('85000.50', 'USD')).toBe(`USD${NBSP}85,000.50`);
  });
});

describe('dates', () => {
  it('formats calendar dates in UTC so the day never shifts', () => {
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026');
    expect(formatDate(null)).toBe('—');
  });

  it('computes tenure in years and months', () => {
    expect(tenure('2022-03-01', '2026-11-19')).toBe('4 yrs 8 mos');
    expect(tenure('2026-11-01', '2026-11-19')).toBe('0 mos');
  });
});

describe('safeNextPath', () => {
  it.each([
    [null, '/dashboard'],
    ['/employees?country=JP', '/employees?country=JP'],
    ['//evil.example', '/dashboard'],
    ['https://evil.example', '/dashboard'],
    ['/\\evil.example', '/dashboard'],
    ['/login', '/dashboard'],
  ])('%s -> %s (no open redirects)', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe('employee list URL state', () => {
  it('round-trips filters, sort and page through the URL', () => {
    const query = parseEmployeeQuery(
      new URLSearchParams(
        'search=sha&country=IN&country=JP&status=ACTIVE&sort=hireDate&order=desc&page=3',
      ),
    );
    expect(query).toMatchObject({
      search: 'sha',
      country: ['IN', 'JP'],
      status: ['ACTIVE'],
      sort: 'hireDate',
      order: 'desc',
      page: 3,
      pageSize: 25,
    });
    expect(serializeEmployeeQuery(query)).toBe(
      'search=sha&country=IN&country=JP&status=ACTIVE&sort=hireDate&order=desc&page=3',
    );
  });

  it('falls back to defaults for a tampered URL instead of crashing', () => {
    expect(parseEmployeeQuery(new URLSearchParams('pageSize=100000&sort=salary'))).toMatchObject({
      sort: 'name',
      page: 1,
      pageSize: 25,
    });
  });
});

describe('buildCorrection', () => {
  const record: CompensationRecord = {
    id: 'c1',
    employeeId: 'e1',
    amount: '1800000.00',
    currency: 'INR',
    effectiveFrom: '2024-04-01',
    effectiveTo: null,
    reason: 'ANNUAL_REVIEW',
    note: null,
    isCurrent: true,
    version: 3,
    createdBy: null,
    createdAt: '',
    updatedAt: '',
  };
  const unchanged = {
    amount: '1800000.00',
    currencyCode: 'INR',
    effectiveFrom: '2024-04-01',
    reason: 'ANNUAL_REVIEW' as const,
    note: '',
    correctionReason: 'Typo',
  };

  it('sends only changed fields with the version that was read', () => {
    expect(buildCorrection(record, { ...unchanged, amount: '1850000' })).toEqual({
      version: 3,
      correctionReason: 'Typo',
      amount: '1850000',
    });
  });

  it('returns null when nothing changed', () => {
    expect(buildCorrection(record, unchanged)).toBeNull();
  });
});
