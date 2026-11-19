import { describe, expect, it } from 'vitest';
import { fitsCurrencyScale } from '@acme/shared';
import { CURRENCIES, SEED_AS_OF } from '../../prisma/seed/data.ts';
import {
  datasetChecksum,
  deterministicUuid,
  generateEmployees,
} from '../../prisma/seed/generator.ts';
import { seedPasswordProblems } from '../../prisma/seed/seed.ts';

const MINOR_UNITS = Object.fromEntries(CURRENCIES.map((c) => [c.code, c.minorUnits]));

describe('seed generator', () => {
  const employees = generateEmployees({ count: 2_000 });

  it('is deterministic: same inputs give byte-identical data; a different seed does not', () => {
    expect(datasetChecksum(generateEmployees({ count: 2_000 }))).toBe(datasetChecksum(employees));
    expect(datasetChecksum(generateEmployees({ count: 2_000, seed: 7 }))).not.toBe(
      datasetChecksum(employees),
    );
  });

  it('generates exactly 10,000 employees by default count with unique identifiers', () => {
    const full = generateEmployees({ count: 10_000 });
    expect(full).toHaveLength(10_000);
    expect(new Set(full.map((e) => e.employeeCode)).size).toBe(10_000);
    expect(new Set(full.map((e) => e.email)).size).toBe(10_000);
    expect(new Set(full.map((e) => e.id)).size).toBe(10_000);
    expect(full.at(-1)!.employeeCode).toBe('EMP-010000');
  });

  it('produces contiguous salary timelines that start on the hire date and never after "as of"', () => {
    for (const e of employees) {
      expect(e.compensations[0]!.effectiveFrom).toBe(e.hireDate);
      e.compensations.forEach((c, i) => {
        expect(c.effectiveTo).toBe(e.compensations[i + 1]?.effectiveFrom ?? null);
        expect(c.effectiveFrom <= SEED_AS_OF).toBe(true);
        if (e.terminationDate) expect(c.effectiveFrom <= e.terminationDate).toBe(true);
      });
    }
  });

  it('respects each currency precision and keeps amounts positive', () => {
    for (const c of employees.flatMap((e) => e.compensations)) {
      expect(Number(c.amount)).toBeGreaterThan(0);
      expect(fitsCurrencyScale(c.amount, MINOR_UNITS[c.currencyCode]!)).toBe(true);
    }
  });

  it('only gives inactive employees a termination date, always on or after hire', () => {
    for (const e of employees) {
      expect(e.terminationDate !== null).toBe(e.status === 'INACTIVE');
      if (e.terminationDate) expect(e.terminationDate >= e.hireDate).toBe(true);
    }
  });

  it('covers the variety the analytics need', () => {
    const distinct = (values: string[]) => new Set(values).size;
    expect(distinct(employees.map((e) => e.countryCode))).toBe(8);
    expect(distinct(employees.flatMap((e) => e.compensations.map((c) => c.currencyCode)))).toBe(7);
    expect(distinct(employees.map((e) => e.status))).toBe(3);
    const withHistory =
      employees.filter((e) => e.compensations.length > 1).length / employees.length;
    expect(withHistory).toBeGreaterThan(0.25);
    expect(withHistory).toBeLessThan(0.6);
    // Some employees are paid in a currency other than their country's (e.g. USD expats).
    expect(
      employees.some((e) => e.countryCode !== 'US' && e.compensations[0]!.currencyCode === 'USD'),
    ).toBe(true);
  });

  it('builds RFC 9562 version-8 UUIDs that are stable per key', () => {
    const id = deterministicUuid('EMP-000001');
    expect(id).toBe(deterministicUuid('EMP-000001'));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('seedPasswordProblems', () => {
  const production = { NODE_ENV: 'production' };

  it('allows the demo passwords outside production', () => {
    expect(
      seedPasswordProblems({ NODE_ENV: 'development' }, 'Manager-Demo-2026!', 'Viewer-Demo-2026!'),
    ).toEqual([]);
  });

  it('refuses a demo password for either account in production', () => {
    // Regression: the old check tested the concatenation and missed a demo manager password.
    expect(
      seedPasswordProblems(production, 'Manager-Demo-2026!', 'A-strong-unique-pass-1'),
    ).toEqual([
      'SEED_MANAGER_PASSWORD is a published demo password (set ALLOW_DEMO_PASSWORDS=1 only for a public demo on synthetic data).',
    ]);
    expect(seedPasswordProblems(production, 'A-strong-unique-pass-1', 'short')).toEqual([
      'SEED_VIEWER_PASSWORD must be at least 12 characters in production.',
    ]);
    expect(
      seedPasswordProblems(production, 'A-strong-unique-pass-1', 'Another-strong-pass-2'),
    ).toEqual([]);
  });

  it('accepts the published demo passwords in production only with an explicit opt-in', () => {
    const demo = { NODE_ENV: 'production', ALLOW_DEMO_PASSWORDS: '1' };
    expect(seedPasswordProblems(demo, 'Manager-Demo-2026!', 'Viewer-Demo-2026!')).toEqual([]);
    // The opt-in is for the published demo values only, not for weak passwords in general.
    expect(seedPasswordProblems(demo, 'Manager-Demo-2026!', 'short')).toEqual([
      'SEED_VIEWER_PASSWORD must be at least 12 characters in production.',
    ]);
    expect(
      seedPasswordProblems(
        { ...demo, ALLOW_DEMO_PASSWORDS: 'true' },
        'Manager-Demo-2026!',
        'Viewer-Demo-2026!',
      ),
    ).toHaveLength(2);
  });
});
