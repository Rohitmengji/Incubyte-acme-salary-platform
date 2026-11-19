import { createHash } from 'node:crypto';
import {
  COUNTRIES,
  CURRENCIES,
  DEPARTMENTS,
  FIRST_NAMES,
  FX_SNAPSHOT,
  LAST_NAMES,
  SEED_AS_OF,
} from './data.ts';

/** Deterministic 32-bit PRNG (mulberry32): same seed, same dataset, on every machine. */
export function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    between: (min: number, max: number) => min + next() * (max - min),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    weighted: <T extends { weight: number }>(items: readonly T[]): T => {
      const total = items.reduce((sum, item) => sum + item.weight, 0);
      let roll = next() * total;
      for (const item of items) {
        roll -= item.weight;
        if (roll < 0) return item;
      }
      return items.at(-1)!;
    },
  };
}

/** Stable UUID (RFC 9562 version 8, "custom") derived from a key, so seeded IDs never change. */
export function deterministicUuid(key: string): string {
  const bytes = createHash('sha256').update(`acme-seed:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const DAY_MS = 86_400_000;
const toDate = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => toIso(toDate(iso) + days * DAY_MS);

const MINOR_UNITS: Record<string, number> = Object.fromEntries(
  CURRENCIES.map((c) => [c.code, c.minorUnits]),
);
const FX_USD_PER_UNIT: Record<string, number> = Object.fromEntries(
  Object.entries(FX_SNAPSHOT.rates).map(([code, rate]) => [code, Number(rate)]),
);

/** Rounds to a realistic step for the currency; results are whole numbers so they fit any scale. */
function roundSalary(amount: number, currency: string): string {
  const step = currency === 'JPY' ? 10_000 : currency === 'INR' ? 1_000 : 500;
  const rounded = Math.max(step, Math.round(amount / step) * step);
  return MINOR_UNITS[currency] === 0 ? String(rounded) : rounded.toFixed(MINOR_UNITS[currency]);
}

export interface SeedCompensation {
  id: string;
  amount: string;
  currencyCode: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: 'NEW_HIRE' | 'ANNUAL_REVIEW' | 'PROMOTION' | 'MARKET_ADJUSTMENT';
}

export interface SeedEmployee {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  countryCode: string;
  departmentName: string;
  jobTitleName: string;
  status: 'ACTIVE' | 'ON_LEAVE' | 'INACTIVE';
  hireDate: string;
  terminationDate: string | null;
  compensations: SeedCompensation[];
}

function emailLocalPart(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export interface GenerateOptions {
  count: number;
  seed?: number;
  asOf?: string;
}

export function generateEmployees({
  count,
  seed = 20_261_101,
  asOf = SEED_AS_OF,
}: GenerateOptions): SeedEmployee[] {
  const random = createRandom(seed);
  const earliestHire = toDate('2012-01-01');
  const latestHire = toDate(asOf) - 30 * DAY_MS;
  const employees: SeedEmployee[] = [];

  for (let n = 1; n <= count; n++) {
    const employeeCode = `EMP-${String(n).padStart(6, '0')}`;
    const firstName = random.pick(FIRST_NAMES);
    const lastName = random.pick(LAST_NAMES);
    const country = random.weighted(COUNTRIES);
    const department = random.weighted(DEPARTMENTS);
    const title = random.weighted(department.titles);
    const hireDate = toIso(
      earliestHire + Math.floor(random.next() * ((latestHire - earliestHire) / DAY_MS)) * DAY_MS,
    );

    const statusRoll = random.next();
    const status = statusRoll < 0.88 ? 'ACTIVE' : statusRoll < 0.92 ? 'ON_LEAVE' : 'INACTIVE';
    const tenureDays = (toDate(asOf) - toDate(hireDate)) / DAY_MS;
    const terminationDate =
      status === 'INACTIVE' && tenureDays > 120
        ? addDays(hireDate, random.int(90, Math.floor(tenureDays) - 1))
        : null;
    const finalStatus = status === 'INACTIVE' && !terminationDate ? 'ACTIVE' : status;
    const lastDay = terminationDate ?? asOf;

    // About 3% of employees outside the US are paid in USD (e.g. expatriates).
    const currency = country.code !== 'US' && random.next() < 0.03 ? 'USD' : country.currency;
    const payFactor = currency === 'USD' ? 1 : country.payFactor;
    const tenureYears = (toDate(lastDay) - toDate(hireDate)) / (365 * DAY_MS);
    const finalUsd =
      title.baseUsd *
      payFactor *
      random.between(0.85, 1.2) *
      Math.min(1.12, 1 + tenureYears * 0.012);

    // Salary history: ~45% of employees with at least 18 months' tenure have 1-3 earlier changes.
    const changeDates = new Set<string>();
    const spanDays = Math.floor((toDate(lastDay) - toDate(hireDate)) / DAY_MS);
    if (spanDays > 540 && random.next() < 0.45) {
      const changes = random.int(1, 3);
      for (let i = 0; i < changes; i++)
        changeDates.add(addDays(hireDate, random.int(180, spanDays - 1)));
    }
    const starts = [hireDate, ...[...changeDates].sort()];
    const reasons = starts.map((_, i) =>
      i === 0
        ? 'NEW_HIRE'
        : random.weighted([
            { value: 'ANNUAL_REVIEW', weight: 60 },
            { value: 'PROMOTION', weight: 25 },
            { value: 'MARKET_ADJUSTMENT', weight: 15 },
          ]).value,
    ) as SeedCompensation['reason'][];

    // Walk backwards from today's salary, removing each raise.
    const usdAmounts = new Array<number>(starts.length);
    usdAmounts[starts.length - 1] = finalUsd;
    for (let i = starts.length - 1; i > 0; i--) {
      const raise =
        reasons[i] === 'PROMOTION' ? random.between(0.1, 0.18) : random.between(0.03, 0.09);
      usdAmounts[i - 1] = usdAmounts[i]! / (1 + raise);
    }
    const fx = currency === 'USD' ? 1 : FX_USD_PER_UNIT[currency]!;

    employees.push({
      id: deterministicUuid(employeeCode),
      employeeCode,
      firstName,
      lastName,
      email: `${emailLocalPart(firstName)}.${emailLocalPart(lastName)}.${String(n).padStart(6, '0')}@acme.example`,
      countryCode: country.code,
      departmentName: department.name,
      jobTitleName: title.name,
      status: finalStatus,
      hireDate,
      terminationDate,
      compensations: starts.map((effectiveFrom, i) => ({
        id: deterministicUuid(`${employeeCode}:${effectiveFrom}`),
        amount: roundSalary(usdAmounts[i]! / fx, currency),
        currencyCode: currency,
        effectiveFrom,
        effectiveTo: starts[i + 1] ?? null,
        reason: reasons[i]!,
      })),
    });
  }
  return employees;
}

/** SHA-256 over the generated dataset; identical across runs and machines for the same inputs. */
export function datasetChecksum(employees: SeedEmployee[]): string {
  return createHash('sha256').update(JSON.stringify(employees)).digest('hex');
}
