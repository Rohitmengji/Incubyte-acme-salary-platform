/**
 * Salary timeline rules (ADR-0003). Pure functions over ISO dates (YYYY-MM-DD compare correctly as
 * strings). Invariant: periods are contiguous - each period ends exactly where the next begins and
 * the last is open-ended. The database exclusion constraint is the backstop for overlaps; these
 * rules also prevent gaps, which the database cannot detect.
 */

export interface Period {
  id: string;
  effectiveFrom: string;
  /** Exclusive end; null = open-ended. */
  effectiveTo: string | null;
}

export interface EmployeeTimelineState {
  hireDate: string;
  status: 'ACTIVE' | 'ON_LEAVE' | 'INACTIVE';
}

export interface PeriodEndChange {
  id: string;
  effectiveTo: string | null;
}

export type TimelineErrorCode =
  | 'EMPLOYEE_INACTIVE'
  | 'BEFORE_HIRE_DATE'
  | 'DATE_TAKEN'
  | 'OUTSIDE_NEIGHBOURS'
  | 'PERIOD_NOT_FOUND'
  | 'CORRUPT_TIMELINE';

export class TimelineError extends Error {
  constructor(
    readonly code: TimelineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TimelineError';
  }
}

function sorted(periods: readonly Period[]): Period[] {
  return [...periods].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

export function assertContiguous(periods: readonly Period[]): void {
  const ordered = sorted(periods);
  ordered.forEach((period, i) => {
    const next = ordered[i + 1];
    const expectedEnd = next ? next.effectiveFrom : null;
    if (period.effectiveTo !== expectedEnd) {
      throw new TimelineError(
        'CORRUPT_TIMELINE',
        `Salary period ${period.id} ends ${period.effectiveTo ?? 'open'} but should end ${expectedEnd ?? 'open'}.`,
      );
    }
  });
}

/** Period in effect on a date: inclusive start, exclusive end. */
export function findPeriodAt<T extends Period>(periods: readonly T[], date: string): T | null {
  return (
    periods.find(
      (p) => p.effectiveFrom <= date && (p.effectiveTo === null || p.effectiveTo > date),
    ) ?? null
  );
}

export interface InsertionPlan {
  newPeriod: { effectiveFrom: string; effectiveTo: string | null };
  endChanges: PeriodEndChange[];
}

/** Plans adding a salary change effective on `effectiveFrom`, anywhere in the timeline. */
export function planInsertion(
  periods: readonly Period[],
  employee: EmployeeTimelineState,
  effectiveFrom: string,
): InsertionPlan {
  if (employee.status === 'INACTIVE') {
    throw new TimelineError(
      'EMPLOYEE_INACTIVE',
      'This employee is inactive. Reactivate them before adding a salary change.',
    );
  }
  if (effectiveFrom < employee.hireDate) {
    throw new TimelineError(
      'BEFORE_HIRE_DATE',
      `The effective date cannot be before the hire date (${employee.hireDate}).`,
    );
  }
  assertContiguous(periods);
  const ordered = sorted(periods);
  if (ordered.some((p) => p.effectiveFrom === effectiveFrom)) {
    throw new TimelineError(
      'DATE_TAKEN',
      `A salary period already starts on ${effectiveFrom}. Correct that record instead.`,
    );
  }

  const previous = ordered.filter((p) => p.effectiveFrom < effectiveFrom).at(-1);
  const next = ordered.find((p) => p.effectiveFrom > effectiveFrom);
  return {
    newPeriod: { effectiveFrom, effectiveTo: next?.effectiveFrom ?? null },
    endChanges: previous ? [{ id: previous.id, effectiveTo: effectiveFrom }] : [],
  };
}

export interface StartDateMovePlan {
  endChanges: PeriodEndChange[];
}

/**
 * Plans correcting a period's start date. It may only move strictly between its neighbours' start
 * dates; the previous period's end moves with it so no gap or overlap appears.
 */
export function planStartDateMove(
  periods: readonly Period[],
  employee: EmployeeTimelineState,
  periodId: string,
  newEffectiveFrom: string,
): StartDateMovePlan {
  assertContiguous(periods);
  const ordered = sorted(periods);
  const index = ordered.findIndex((p) => p.id === periodId);
  if (index === -1) throw new TimelineError('PERIOD_NOT_FOUND', 'Salary record not found.');

  const target = ordered[index]!;
  if (newEffectiveFrom === target.effectiveFrom) return { endChanges: [] };
  if (newEffectiveFrom < employee.hireDate) {
    throw new TimelineError(
      'BEFORE_HIRE_DATE',
      `The effective date cannot be before the hire date (${employee.hireDate}).`,
    );
  }

  const previous = ordered[index - 1];
  const next = ordered[index + 1];
  if (
    (previous && newEffectiveFrom <= previous.effectiveFrom) ||
    (next && newEffectiveFrom >= next.effectiveFrom)
  ) {
    throw new TimelineError(
      'OUTSIDE_NEIGHBOURS',
      `The effective date must be after ${previous?.effectiveFrom ?? employee.hireDate}` +
        `${next ? ` and before ${next.effectiveFrom}` : ''}. To reorder history, add a new salary change instead.`,
    );
  }
  return { endChanges: previous ? [{ id: previous.id, effectiveTo: newEffectiveFrom }] : [] };
}
