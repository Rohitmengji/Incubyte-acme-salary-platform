/**
 * Display formatting. Money arrives as decimal strings and is formatted directly from the string
 * (Intl.NumberFormat accepts numeric strings), so no value passes through a binary float (ADR-0002).
 */

import { decimalPlaces } from '@acme/shared';

const moneyFormatters = new Map<string, Intl.NumberFormat>();

/**
 * The API already rounds money to the currency's minor units, so the number of decimals is taken
 * from the string itself: what the server sends is exactly what is shown.
 */
export function formatMoney(amount: string, currency: string): string {
  const digits = decimalPlaces(amount);
  const key = `${currency}:${digits}`;
  let formatter = moneyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    moneyFormatters.set(key, formatter);
  }
  return formatter.format(amount as `${number}`);
}

/** Compact money for chart axes and dense KPIs, e.g. "USD 81.4K". Display-only. */
export function formatMoneyCompact(amount: string | number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount as `${number}`);
}

const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** "20000" -> "20K", for chart labels. Display-only. */
export function formatCompactNumber(value: string | number): string {
  return compactNumber.format(value as `${number}`);
}

const integer = new Intl.NumberFormat('en-US');

export function formatCount(value: number): string {
  return integer.format(value);
}

/** Business dates are calendar dates: format in UTC so the day never shifts with the viewer's zone. */
const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  return dateFormatter.format(new Date(`${isoDate.slice(0, 10)}T00:00:00Z`));
}

const monthFormatter = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});

export function formatMonth(isoDate: string): string {
  return monthFormatter.format(new Date(`${isoDate}T00:00:00Z`));
}

/** Timestamps (audit events) are shown in the viewer's local time. */
const timestampFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatTimestamp(iso: string): string {
  return timestampFormatter.format(new Date(iso));
}

export function humanize(value: string): string {
  const text = value.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Years and months between two calendar dates, e.g. "4 yrs 8 mos". */
export function tenure(fromIso: string, toIso: string): string {
  const [fy, fm, fd] = fromIso.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = toIso.split('-').map(Number) as [number, number, number];
  let months = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years) parts.push(`${years} yr${years === 1 ? '' : 's'}`);
  if (rest || !years) parts.push(`${rest} mo${rest === 1 ? '' : 's'}`);
  return parts.join(' ');
}
