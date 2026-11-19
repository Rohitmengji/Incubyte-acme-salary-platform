import { z } from 'zod';
import { fitsCurrencyScale } from '@acme/shared';
import type { Db } from '../db.ts';
import { BusinessRuleError, NotFoundError, type FieldError } from '../http/errors.ts';
import { TimelineError } from '../domain/timeline.ts';
import { ConflictError } from '../http/errors.ts';

const uuid = z.uuid();

/** Malformed IDs are reported as "not found" rather than leaking validation details. */
export function parseId(value: unknown, what: string): string {
  const result = uuid.safeParse(value);
  if (!result.success) throw new NotFoundError(what);
  return result.data;
}

/**
 * Serialises salary writes per employee: every compensation/employee write takes this row lock
 * first, so concurrent requests see each other's committed periods (ADR-0003).
 */
export async function lockEmployee(tx: Db, employeeId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM employee WHERE id = ${employeeId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundError('Employee');
}

/** Validates foreign keys with field-level messages instead of a generic FK violation. */
export async function assertReferencesExist(
  tx: Db,
  refs: { countryCode?: string; departmentId?: number; jobTitleId?: number },
): Promise<void> {
  const [country, department, jobTitle] = await Promise.all([
    refs.countryCode ? tx.country.findUnique({ where: { code: refs.countryCode } }) : true,
    refs.departmentId ? tx.department.findUnique({ where: { id: refs.departmentId } }) : true,
    refs.jobTitleId ? tx.jobTitle.findUnique({ where: { id: refs.jobTitleId } }) : true,
  ]);
  const errors: FieldError[] = [];
  if (!country) errors.push({ path: 'countryCode', message: 'Unknown country' });
  if (!department) errors.push({ path: 'departmentId', message: 'Unknown department' });
  if (!jobTitle) errors.push({ path: 'jobTitleId', message: 'Unknown job title' });
  if (errors.length) throw new BusinessRuleError('Some referenced records do not exist.', errors);
}

/** Returns the currency's minor units after checking the amount fits them (ADR-0002). */
export async function assertAmountForCurrency(
  tx: Db,
  amount: string,
  currencyCode: string,
  pathPrefix = '',
): Promise<void> {
  const currency = await tx.currency.findUnique({ where: { code: currencyCode } });
  if (!currency) {
    throw new BusinessRuleError('Unsupported currency.', [
      { path: `${pathPrefix}currencyCode`, message: `${currencyCode} is not a supported currency` },
    ]);
  }
  if (!fitsCurrencyScale(amount, currency.minorUnits)) {
    throw new BusinessRuleError('The amount has too many decimal places for its currency.', [
      {
        path: `${pathPrefix}amount`,
        message:
          currency.minorUnits === 0
            ? `${currency.code} amounts must be whole numbers`
            : `${currency.code} amounts allow at most ${currency.minorUnits} decimal places`,
      },
    ]);
  }
}

export function mapTimelineError(error: unknown, pathPrefix = ''): never {
  if (!(error instanceof TimelineError)) throw error;
  const field = [{ path: `${pathPrefix}effectiveFrom`, message: error.message }];
  switch (error.code) {
    case 'DATE_TAKEN':
      throw new ConflictError(error.message, field, 'salary-date-taken');
    case 'BEFORE_HIRE_DATE':
    case 'OUTSIDE_NEIGHBOURS':
      throw new BusinessRuleError(error.message, field);
    case 'EMPLOYEE_INACTIVE':
      throw new BusinessRuleError(error.message);
    case 'PERIOD_NOT_FOUND':
      throw new NotFoundError('Salary record');
    case 'CORRUPT_TIMELINE':
      // Should be impossible; surface as a 500 and log rather than guessing a repair.
      throw error;
  }
}
