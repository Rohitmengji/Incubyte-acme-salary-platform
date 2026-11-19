import { z } from 'zod';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30, 2025-02-29). */
export function isIsoCalendarDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Business dates are calendar dates. "Today" is evaluated in UTC (requirements: assumptions). */
export function utcToday(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export const isoDateSchema = z
  .string()
  .trim()
  .refine(isIsoCalendarDate, 'Must be a valid date in YYYY-MM-DD format')
  .refine(
    (value) => value >= '1900-01-01' && value <= '2100-12-31',
    'Must be between 1900 and 2100',
  );
