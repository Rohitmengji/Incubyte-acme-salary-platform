import { describe, expect, it } from 'vitest';
import {
  assertContiguous,
  findPeriodAt,
  planInsertion,
  planStartDateMove,
  TimelineError,
  type Period,
} from '../../src/domain/timeline.ts';

const active = { hireDate: '2020-01-15', status: 'ACTIVE' as const };

function timeline(...starts: string[]): Period[] {
  return starts.map((effectiveFrom, i) => ({
    id: `p${i + 1}`,
    effectiveFrom,
    effectiveTo: starts[i + 1] ?? null,
  }));
}

/** Applies a plan the way the service does, so tests can assert the resulting invariant. */
function applyInsertion(
  periods: Period[],
  plan: ReturnType<typeof planInsertion>,
  id = 'new',
): Period[] {
  const updated = periods.map((p) => {
    const change = plan.endChanges.find((c) => c.id === p.id);
    return change ? { ...p, effectiveTo: change.effectiveTo } : p;
  });
  return [...updated, { id, ...plan.newPeriod }];
}

function expectCode(fn: () => unknown, code: TimelineError['code']) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(TimelineError);
    expect((error as TimelineError).code).toBe(code);
    return;
  }
  throw new Error(`Expected TimelineError ${code}`);
}

describe('planInsertion', () => {
  it('opens the first period for an employee without salary history', () => {
    const plan = planInsertion([], active, '2020-01-15');
    expect(plan).toEqual({
      newPeriod: { effectiveFrom: '2020-01-15', effectiveTo: null },
      endChanges: [],
    });
  });

  it('closes the open period when a later change is appended', () => {
    const plan = planInsertion(timeline('2020-01-15'), active, '2023-04-01');
    expect(plan.newPeriod).toEqual({ effectiveFrom: '2023-04-01', effectiveTo: null });
    expect(plan.endChanges).toEqual([{ id: 'p1', effectiveTo: '2023-04-01' }]);
  });

  it('inserts before an already scheduled future raise without overlapping it', () => {
    const periods = timeline('2020-01-15', '2027-01-01');
    const plan = planInsertion(periods, active, '2026-06-01');
    expect(plan.newPeriod).toEqual({ effectiveFrom: '2026-06-01', effectiveTo: '2027-01-01' });
    expect(plan.endChanges).toEqual([{ id: 'p1', effectiveTo: '2026-06-01' }]);
    expect(() => assertContiguous(applyInsertion(periods, plan))).not.toThrow();
  });

  it('inserts before the first known period (history imported late) and ends where it begins', () => {
    const plan = planInsertion(timeline('2022-01-01'), active, '2020-01-15');
    expect(plan.newPeriod).toEqual({ effectiveFrom: '2020-01-15', effectiveTo: '2022-01-01' });
    expect(plan.endChanges).toEqual([]);
  });

  it('allows a change on the hire date but not before it', () => {
    expect(() => planInsertion([], active, '2020-01-15')).not.toThrow();
    expectCode(() => planInsertion([], active, '2020-01-14'), 'BEFORE_HIRE_DATE');
  });

  it('rejects a second period starting on an existing start date (use a correction instead)', () => {
    expectCode(
      () => planInsertion(timeline('2020-01-15', '2023-04-01'), active, '2023-04-01'),
      'DATE_TAKEN',
    );
  });

  it('rejects new periods for inactive employees', () => {
    expectCode(
      () => planInsertion(timeline('2020-01-15'), { ...active, status: 'INACTIVE' }, '2024-01-01'),
      'EMPLOYEE_INACTIVE',
    );
  });

  it('allows changes for employees on leave', () => {
    expect(() =>
      planInsertion(timeline('2020-01-15'), { ...active, status: 'ON_LEAVE' }, '2024-01-01'),
    ).not.toThrow();
  });

  it('accepts periods in any order', () => {
    const shuffled = [...timeline('2020-01-15', '2021-01-01', '2022-01-01')].reverse();
    const plan = planInsertion(shuffled, active, '2021-06-01');
    expect(plan.newPeriod).toEqual({ effectiveFrom: '2021-06-01', effectiveTo: '2022-01-01' });
    expect(plan.endChanges).toEqual([{ id: 'p2', effectiveTo: '2021-06-01' }]);
  });

  it('refuses to plan on a corrupt timeline instead of guessing', () => {
    const gap: Period[] = [
      { id: 'p1', effectiveFrom: '2020-01-15', effectiveTo: '2021-01-01' },
      { id: 'p2', effectiveFrom: '2021-02-01', effectiveTo: null },
    ];
    expectCode(() => planInsertion(gap, active, '2022-01-01'), 'CORRUPT_TIMELINE');
  });

  it('keeps the timeline contiguous across many insertions in random order', () => {
    let periods: Period[] = [];
    let seed = 42;
    const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
    const used = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const day = new Date(Date.UTC(2020, 0, 15) + Math.floor(random() * 3650) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      if (used.has(day)) continue;
      used.add(day);
      periods = applyInsertion(periods, planInsertion(periods, active, day), `n${i}`);
      expect(() => assertContiguous(periods)).not.toThrow();
    }
  });
});

describe('planStartDateMove', () => {
  const periods = timeline('2020-01-15', '2022-01-01', '2024-01-01');

  it('moves a start date later and moves the previous end with it (no gap)', () => {
    const plan = planStartDateMove(periods, active, 'p2', '2022-03-01');
    expect(plan.endChanges).toEqual([{ id: 'p1', effectiveTo: '2022-03-01' }]);
  });

  it('moves a start date earlier and shortens the previous period (no overlap)', () => {
    const plan = planStartDateMove(periods, active, 'p2', '2021-10-01');
    expect(plan.endChanges).toEqual([{ id: 'p1', effectiveTo: '2021-10-01' }]);
  });

  it.each([
    ['onto the previous start', 'p2', '2020-01-15'],
    ['before the previous start', 'p3', '2021-06-01'],
    ['onto the next start', 'p2', '2024-01-01'],
    ['past the next start', 'p2', '2024-06-01'],
  ])('rejects moving %s', (_label, id, date) => {
    expectCode(() => planStartDateMove(periods, active, id, date), 'OUTSIDE_NEIGHBOURS');
  });

  it('lets the first period move later (earlier history becomes unknown) but never before hire', () => {
    expect(planStartDateMove(periods, active, 'p1', '2020-06-01').endChanges).toEqual([]);
    expectCode(() => planStartDateMove(periods, active, 'p1', '2020-01-01'), 'BEFORE_HIRE_DATE');
  });

  it('allows corrections on inactive employees (fixing history is still needed)', () => {
    expect(() =>
      planStartDateMove(periods, { ...active, status: 'INACTIVE' }, 'p3', '2024-02-01'),
    ).not.toThrow();
  });

  it('is a no-op when the date does not change', () => {
    expect(planStartDateMove(periods, active, 'p2', '2022-01-01').endChanges).toEqual([]);
  });

  it('reports unknown periods', () => {
    expectCode(() => planStartDateMove(periods, active, 'nope', '2022-02-01'), 'PERIOD_NOT_FOUND');
  });
});

describe('findPeriodAt', () => {
  const periods = timeline('2020-01-15', '2022-01-01');

  it('uses an inclusive start and exclusive end', () => {
    expect(findPeriodAt(periods, '2021-12-31')?.id).toBe('p1');
    expect(findPeriodAt(periods, '2022-01-01')?.id).toBe('p2');
    expect(findPeriodAt(periods, '2099-01-01')?.id).toBe('p2');
  });

  it('returns null before the first period', () => {
    expect(findPeriodAt(periods, '2020-01-14')).toBeNull();
  });
});
