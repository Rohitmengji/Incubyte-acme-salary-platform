import { z } from 'zod';

/**
 * Money travels as a decimal string, never a JSON number (ADR-0002).
 * Up to 15 integer digits and 4 fractional digits fits NUMERIC(19,4).
 */
const DECIMAL_AMOUNT = /^(0|[1-9]\d{0,14})(\.\d{1,4})?$/;

export function decimalPlaces(amount: string): number {
  const dot = amount.indexOf('.');
  return dot === -1 ? 0 : amount.length - dot - 1;
}

/** Rejects amounts with more fractional digits than the currency allows (JPY 0, USD 2). */
export function fitsCurrencyScale(amount: string, minorUnits: number): boolean {
  return decimalPlaces(amount) <= minorUnits;
}

export const amountSchema = z
  .string()
  .trim()
  .regex(
    DECIMAL_AMOUNT,
    'Must be a plain decimal number such as 85000 or 85000.50 (no thousands separators or currency symbols)',
  )
  .refine((value) => /[1-9]/.test(value), 'Must be greater than zero');

export const currencyCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO 4217 currency code'));

export interface Money {
  /** Decimal string padded to the currency's minor units, e.g. "125000.00" or "9800000". */
  amount: string;
  currency: string;
}
