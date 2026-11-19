import {
  EMPLOYEE_STATUSES,
  REPORTING_CURRENCY,
  type AnalyticsDimension,
  type AnalyticsSummary,
  type CurrencyMode,
  type DistributionResponse,
  type DistributionRow,
  type EmployeeStatus,
  type FxSnapshot,
  type HistogramResponse,
  type PayStats,
  type RecentSalaryChange,
  type TrendsResponse,
} from '@acme/shared';
import { Prisma, type PrismaClient } from '../../db.ts';
import { toIsoDate, type Clock } from '../../lib/clock.ts';

/**
 * Salary analytics computed on read in PostgreSQL (ADR-0004).
 * - Money is NUMERIC end to end and rounded once, in SQL, to the currency's minor units.
 * - Medians are exact: the average of the middle one/two rows. percentile_cont is avoided because it
 *   returns double precision even for NUMERIC input (ADR-0002).
 * - Amounts in different currencies are never combined unless converted with the dated FX snapshot.
 * - Population on a date = hired on or before it and not terminated on or before it.
 */

type GroupBy = AnalyticsDimension | 'all';

const SMALL_SAMPLE = 5;
const HISTOGRAM_USD_WIDTH = 20_000;
const HISTOGRAM_USD_BUCKETS = 16; // last bucket is open-ended (300k+)
const HISTOGRAM_LOCAL_BUCKETS = 12;

interface StatsRow {
  key: string;
  label: string;
  currency: string;
  n: number;
  min: string;
  max: string;
  avg: string;
  median: string;
  p25: string;
  p75: string;
  total: string;
}

const employedOn = (date: Prisma.Sql) =>
  Prisma.sql`e.hire_date <= ${date} AND (e.termination_date IS NULL OR e.termination_date > ${date})`;

const paidOn = (date: Prisma.Sql) =>
  Prisma.sql`c.employee_id = e.id AND c.effective_from <= ${date} AND (c.effective_to IS NULL OR c.effective_to > ${date})`;

/** The single FX snapshot in force on `asOf`: rates from the latest as_of_date on or before it. */
const fxCte = (asOf: string) => Prisma.sql`
  fx AS (
    SELECT currency_code, rate_to_reporting
    FROM exchange_rate
    WHERE as_of_date = (SELECT max(as_of_date) FROM exchange_rate WHERE as_of_date <= ${asOf}::date)
  )`;

function grouping(groupBy: GroupBy) {
  switch (groupBy) {
    case 'all':
      return { key: Prisma.sql`'all'`, label: Prisma.sql`'All employees'`, join: Prisma.empty };
    case 'country':
      return {
        key: Prisma.sql`e.country_code::text`,
        label: Prisma.sql`g.name`,
        join: Prisma.sql`JOIN country g ON g.code = e.country_code`,
      };
    case 'department':
      return {
        key: Prisma.sql`e.department_id::text`,
        label: Prisma.sql`g.name`,
        join: Prisma.sql`JOIN department g ON g.id = e.department_id`,
      };
    case 'jobTitle':
      return {
        key: Prisma.sql`e.job_title_id::text`,
        label: Prisma.sql`g.name`,
        join: Prisma.sql`JOIN job_title g ON g.id = e.job_title_id`,
      };
  }
}

function toPayStats(row: StatsRow): PayStats {
  return {
    currency: row.currency,
    n: row.n,
    min: row.min,
    max: row.max,
    avg: row.avg,
    median: row.median,
    p25: row.p25,
    p75: row.p75,
    total: row.total,
    smallSample: row.n < SMALL_SAMPLE,
  };
}

export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: Clock,
  ) {}

  async fxSnapshot(asOf: string): Promise<FxSnapshot | null> {
    const snapshot = await this.prisma.exchangeRate.findFirst({
      where: { asOfDate: { lte: new Date(`${asOf}T00:00:00.000Z`) } },
      orderBy: { asOfDate: 'desc' },
      select: { asOfDate: true, source: true },
    });
    return snapshot
      ? {
          asOfDate: toIsoDate(snapshot.asOfDate),
          source: snapshot.source,
          reportingCurrency: REPORTING_CURRENCY,
        }
      : null;
  }

  /** Statistics per group and pay currency (local) or per group in USD (normalized). */
  private async stats(asOf: string, groupBy: GroupBy, mode: CurrencyMode): Promise<StatsRow[]> {
    const g = grouping(groupBy);
    const normalized = mode === 'normalized';
    const date = Prisma.sql`${asOf}::date`;
    return this.prisma.$queryRaw<StatsRow[]>`
      WITH ${fxCte(asOf)},
      pay AS (
        SELECT ${g.key} AS key, ${g.label} AS label,
               ${normalized ? Prisma.sql`${REPORTING_CURRENCY}::text` : Prisma.sql`c.currency_code::text`} AS currency,
               ${normalized ? Prisma.sql`c.amount * fx.rate_to_reporting` : Prisma.sql`c.amount`} AS value
        FROM employee e
        JOIN compensation c ON ${paidOn(date)}
        ${g.join}
        ${normalized ? Prisma.sql`JOIN fx ON fx.currency_code = c.currency_code` : Prisma.empty}
        WHERE ${employedOn(date)}
      ),
      ranked AS (
        SELECT key, label, currency, value,
               row_number() OVER (PARTITION BY key, currency ORDER BY value) AS rn,
               count(*) OVER (PARTITION BY key, currency) AS n
        FROM pay
      )
      SELECT r.key, r.label, r.currency, r.n::int AS n,
             round(min(r.value), cur.minor_units)::text AS min,
             round(max(r.value), cur.minor_units)::text AS max,
             round(avg(r.value), cur.minor_units)::text AS avg,
             round(avg(r.value) FILTER (WHERE r.rn IN ((r.n + 1) / 2, (r.n + 2) / 2)), cur.minor_units)::text AS median,
             round(percentile_disc(0.25) WITHIN GROUP (ORDER BY r.value), cur.minor_units)::text AS p25,
             round(percentile_disc(0.75) WITHIN GROUP (ORDER BY r.value), cur.minor_units)::text AS p75,
             round(sum(r.value), cur.minor_units)::text AS total
      FROM ranked r
      JOIN currency cur ON cur.code = r.currency
      GROUP BY r.key, r.label, r.currency, r.n, cur.minor_units
      ORDER BY r.label, r.currency`;
  }

  async summary(): Promise<AnalyticsSummary> {
    const asOf = this.clock.today();
    const date = Prisma.sql`${asOf}::date`;
    const [statusGroups, byCountry, local, normalized, fx, missing] = await Promise.all([
      this.prisma.employee.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.$queryRaw<{ code: string; name: string; count: number }[]>`
        SELECT co.code::text AS code, co.name, count(*)::int AS count
        FROM employee e JOIN country co ON co.code = e.country_code
        WHERE ${employedOn(date)}
        GROUP BY co.code, co.name
        ORDER BY count DESC, co.name`,
      this.stats(asOf, 'all', 'local'),
      this.stats(asOf, 'all', 'normalized'),
      this.fxSnapshot(asOf),
      this.prisma.$queryRaw<{ n: number }[]>`
        WITH ${fxCte(asOf)}
        SELECT count(*)::int AS n
        FROM employee e JOIN compensation c ON ${paidOn(date)}
        WHERE ${employedOn(date)} AND NOT EXISTS (SELECT 1 FROM fx WHERE fx.currency_code = c.currency_code)`,
    ]);

    const byStatus = Object.fromEntries(EMPLOYEE_STATUSES.map((s) => [s, 0])) as Record<
      EmployeeStatus,
      number
    >;
    for (const group of statusGroups) byStatus[group.status] = group._count._all;

    return {
      asOf,
      records: { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus },
      employedHeadcount: byCountry.reduce((sum, row) => sum + row.count, 0),
      headcountByCountry: byCountry,
      payByCurrency: local.map(toPayStats).sort((a, b) => b.n - a.n),
      normalized: normalized[0] ? toPayStats(normalized[0]) : null,
      fx,
      missingFxRates: missing[0]?.n ?? 0,
    };
  }

  async distribution(
    dimension: AnalyticsDimension,
    currencyMode: CurrencyMode,
  ): Promise<DistributionResponse> {
    const asOf = this.clock.today();
    const [rows, fx] = await Promise.all([
      this.stats(asOf, dimension, currencyMode),
      this.fxSnapshot(asOf),
    ]);
    const result: DistributionRow[] = rows.map((row) => ({
      key: row.key,
      label: row.label,
      ...toPayStats(row),
    }));
    return { asOf, dimension, currencyMode, fx, rows: result };
  }

  async histogram(currency?: string): Promise<HistogramResponse> {
    const asOf = this.clock.today();
    const date = Prisma.sql`${asOf}::date`;
    const fx = await this.fxSnapshot(asOf);

    if (!currency) {
      const counts = await this.prisma.$queryRaw<{ bucket: number; count: number }[]>`
        WITH ${fxCte(asOf)}
        SELECT LEAST(floor(c.amount * fx.rate_to_reporting / ${HISTOGRAM_USD_WIDTH})::int, ${HISTOGRAM_USD_BUCKETS - 1}::int) AS bucket,
               count(*)::int AS count
        FROM employee e
        JOIN compensation c ON ${paidOn(date)}
        JOIN fx ON fx.currency_code = c.currency_code
        WHERE ${employedOn(date)}
        GROUP BY 1 ORDER BY 1`;
      const byBucket = new Map(counts.map((row) => [row.bucket, row.count]));
      return {
        asOf,
        currency: REPORTING_CURRENCY,
        normalized: true,
        fx,
        buckets: Array.from({ length: HISTOGRAM_USD_BUCKETS }, (_, i) => ({
          from: String(i * HISTOGRAM_USD_WIDTH),
          to: i === HISTOGRAM_USD_BUCKETS - 1 ? null : String((i + 1) * HISTOGRAM_USD_WIDTH),
          count: byBucket.get(i) ?? 0,
        })),
      };
    }

    const range = await this.prisma.$queryRaw<{ min: string | null; max: string | null }[]>`
      SELECT min(c.amount)::text AS min, max(c.amount)::text AS max
      FROM employee e JOIN compensation c ON ${paidOn(date)}
      WHERE ${employedOn(date)} AND c.currency_code = ${currency}`;
    const { min, max } = range[0] ?? { min: null, max: null };
    if (min === null || max === null) return { asOf, currency, normalized: false, fx, buckets: [] };

    // Bucket bounds are display labels, so a "nice" whole-number width is derived from the range.
    const width = niceWidth((Number(max) - Number(min)) / HISTOGRAM_LOCAL_BUCKETS);
    const start = Math.floor(Number(min) / width) * width;
    const count = Math.max(1, Math.floor((Number(max) - start) / width) + 1);
    const counts = await this.prisma.$queryRaw<{ bucket: number; count: number }[]>`
      SELECT floor((c.amount - ${start}::numeric) / ${width}::numeric)::int AS bucket, count(*)::int AS count
      FROM employee e JOIN compensation c ON ${paidOn(date)}
      WHERE ${employedOn(date)} AND c.currency_code = ${currency}
      GROUP BY 1 ORDER BY 1`;
    const byBucket = new Map(counts.map((row) => [row.bucket, row.count]));
    return {
      asOf,
      currency,
      normalized: false,
      fx,
      buckets: Array.from({ length: count }, (_, i) => ({
        from: String(start + i * width),
        to: String(start + (i + 1) * width),
        count: byBucket.get(i) ?? 0,
      })),
    };
  }

  /** Monthly USD-normalised median/average for the people employed at each month end. */
  async trends(months: number): Promise<TrendsResponse> {
    const asOf = this.clock.today();
    const fx = await this.fxSnapshot(asOf);
    const points = await this.prisma.$queryRaw<
      { date: string; n: number; median: string; avg: string }[]
    >`
      WITH ${fxCte(asOf)},
      months AS MATERIALIZED (
        SELECT LEAST(
                 (date_trunc('month', ${asOf}::date) - make_interval(months => g) + interval '1 month - 1 day')::date,
                 ${asOf}::date) AS d
        FROM generate_series(0, ${months - 1}::int) AS g
      ),
      pay AS (
        SELECT m.d, c.amount * fx.rate_to_reporting AS value
        FROM months m
        JOIN employee e ON ${employedOn(Prisma.sql`m.d`)}
        JOIN compensation c ON ${paidOn(Prisma.sql`m.d`)}
        JOIN fx ON fx.currency_code = c.currency_code
      ),
      ranked AS (
        SELECT d, value,
               row_number() OVER (PARTITION BY d ORDER BY value) AS rn,
               count(*) OVER (PARTITION BY d) AS n
        FROM pay
      )
      SELECT d::text AS date, n::int AS n,
             round(avg(value) FILTER (WHERE rn IN ((n + 1) / 2, (n + 2) / 2)), 2)::text AS median,
             round(avg(value), 2)::text AS avg
      FROM ranked
      GROUP BY d, n
      ORDER BY d`;
    return { asOf, currency: REPORTING_CURRENCY, fx, points };
  }

  async recentChanges(limit: number): Promise<RecentSalaryChange[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        entityType: 'COMPENSATION',
        action: { in: ['COMPENSATION_CREATED', 'COMPENSATION_CORRECTED'] },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: {
        actor: { select: { id: true, displayName: true } },
        employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
      },
    });
    return rows.flatMap((row) => {
      if (!row.employee) return [];
      const changes = (row.changes ?? {}) as {
        before?: Record<string, string | null>;
        after?: Record<string, string | null>;
        correctionReason?: string;
      };
      return [
        {
          id: row.id.toString(),
          occurredAt: row.occurredAt.toISOString(),
          action: row.action as RecentSalaryChange['action'],
          employee: row.employee,
          actor: row.actor,
          before: changes.before ?? null,
          after: changes.after ?? {},
          correctionReason: changes.correctionReason ?? null,
        },
      ];
    });
  }
}

/** Rounds a raw bucket width up to 1, 2, 2.5 or 5 x 10^k so labels read naturally. */
export function niceWidth(raw: number): number {
  if (!(raw > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * magnitude >= raw) ?? 10;
  return Math.max(1, Math.ceil(step * magnitude));
}
