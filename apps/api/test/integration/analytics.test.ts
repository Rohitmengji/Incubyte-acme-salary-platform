import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { buildApp, loginAs, prisma, REF, resetDatabase } from './helpers.ts';

/**
 * Hand-computed fixture ("today" = 2026-11-19). Expected values are worked out in the comments so a
 * reader can check them without running anything.
 *
 * Current pay (employed on 2026-11-19):
 *   USD: L 80000 (IN, expat), C 90000, A 100000, B 120000, D 150000.50           -> n=5
 *   INR: E 1800000, F 2400000.50                                                  -> n=2
 *   JPY: H 7000000, I 8000000, G 9800000                                          -> n=3
 * Excluded: J (terminated 2026-06-30), K (hired 2027-01-01), A's raise effective 2027-01-01.
 * FX snapshot used: 2026-10-31 (USD 1, INR 0.0115, JPY 0.0066). The 2025 and 2027 snapshots must not be.
 */
const DATA = [
  {
    code: 'A',
    country: 'US',
    dept: REF.engineering,
    hire: '2020-01-01',
    pay: [
      ['100000', 'USD', '2020-01-01'],
      ['200000', 'USD', '2027-01-01'],
    ],
  },
  {
    code: 'B',
    country: 'US',
    dept: REF.engineering,
    hire: '2020-01-01',
    pay: [['120000', 'USD', '2020-01-01']],
  },
  {
    code: 'C',
    country: 'US',
    dept: REF.engineering,
    hire: '2020-01-01',
    pay: [['90000', 'USD', '2020-01-01']],
  },
  {
    code: 'D',
    country: 'US',
    dept: REF.engineering,
    hire: '2025-06-01',
    pay: [['150000.50', 'USD', '2025-06-01']],
  },
  {
    code: 'E',
    country: 'IN',
    dept: REF.engineering,
    hire: '2021-01-01',
    pay: [['1800000', 'INR', '2021-01-01']],
  },
  {
    code: 'F',
    country: 'IN',
    dept: REF.engineering,
    hire: '2021-01-01',
    pay: [['2400000.50', 'INR', '2021-01-01']],
  },
  {
    code: 'L',
    country: 'IN',
    dept: REF.engineering,
    hire: '2022-01-01',
    pay: [['80000', 'USD', '2022-01-01']],
  },
  {
    code: 'G',
    country: 'JP',
    dept: REF.finance,
    hire: '2019-01-01',
    pay: [['9800000', 'JPY', '2019-01-01']],
  },
  {
    code: 'H',
    country: 'JP',
    dept: REF.finance,
    hire: '2019-01-01',
    pay: [['7000000', 'JPY', '2019-01-01']],
  },
  {
    code: 'I',
    country: 'JP',
    dept: REF.finance,
    hire: '2019-01-01',
    pay: [['8000000', 'JPY', '2019-01-01']],
  },
  {
    code: 'J',
    country: 'US',
    dept: REF.engineering,
    hire: '2020-01-01',
    end: '2026-06-30',
    pay: [['500000', 'USD', '2020-01-01']],
  },
  {
    code: 'K',
    country: 'US',
    dept: REF.engineering,
    hire: '2027-01-01',
    pay: [['999999', 'USD', '2027-01-01']],
  },
] as const;

let viewer: TestAgent;
const get = async (path: string) => {
  const res = await viewer.get(`/api/v1/analytics${path}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};

beforeAll(async () => {
  await resetDatabase();
  const rates = (asOf: string, inr: string) => [
    { currencyCode: 'USD', rateToReporting: '1', asOfDate: new Date(asOf), source: 'test' },
    { currencyCode: 'INR', rateToReporting: inr, asOfDate: new Date(asOf), source: 'test' },
    { currencyCode: 'JPY', rateToReporting: '0.0066', asOfDate: new Date(asOf), source: 'test' },
  ];
  await prisma.exchangeRate.createMany({
    data: [
      ...rates('2025-01-01', '0.02'),
      ...rates('2026-10-31', '0.0115'),
      ...rates('2027-01-01', '1'),
    ],
  });
  for (const e of DATA) {
    const end = 'end' in e ? e.end : null;
    const employee = await prisma.employee.create({
      data: {
        employeeCode: `EMP-${e.code}`,
        firstName: e.code,
        lastName: 'Fixture',
        email: `${e.code.toLowerCase()}@fixture.example`,
        countryCode: e.country,
        departmentId: e.dept,
        jobTitleId: REF.softwareEngineer,
        hireDate: new Date(e.hire),
        status: end ? 'INACTIVE' : 'ACTIVE',
        terminationDate: end ? new Date(end) : null,
      },
    });
    await prisma.compensation.createMany({
      data: e.pay.map(([amount, currencyCode, from], i) => ({
        employeeId: employee.id,
        amount,
        currencyCode,
        effectiveFrom: new Date(from),
        effectiveTo: e.pay[i + 1] ? new Date(e.pay[i + 1]![2]) : null,
        reason: i === 0 ? 'NEW_HIRE' : 'ANNUAL_REVIEW',
      })),
    });
  }
  viewer = await loginAs(buildApp().app, 'viewer');
});
afterAll(() => prisma.$disconnect());

describe('GET /analytics/summary', () => {
  it('separates record counts, employed headcount and per-currency pay', async () => {
    const body = await get('/summary');
    expect(body.asOf).toBe('2026-11-19');
    expect(body.records).toEqual({ total: 12, byStatus: { ACTIVE: 11, ON_LEAVE: 0, INACTIVE: 1 } });
    expect(body.employedHeadcount).toBe(10);
    expect(body.headcountByCountry).toEqual([
      { code: 'US', name: 'United States', count: 4 },
      { code: 'IN', name: 'India', count: 3 },
      { code: 'JP', name: 'Japan', count: 3 },
    ]);
  });

  it('computes exact per-currency statistics without mixing currencies', async () => {
    const { payByCurrency } = await get('/summary');
    // USD sorted: 80000, 90000, 100000, 120000, 150000.50 -> median 100000, avg 540000.50/5 = 108000.10
    expect(payByCurrency).toContainEqual({
      currency: 'USD',
      n: 5,
      min: '80000.00',
      max: '150000.50',
      avg: '108000.10',
      median: '100000.00',
      p25: '90000.00',
      p75: '120000.00',
      total: '540000.50',
      smallSample: false,
    });
    // INR: even count -> median is the mean of both middle values: (1800000 + 2400000.50) / 2
    expect(payByCurrency).toContainEqual(
      expect.objectContaining({
        currency: 'INR',
        n: 2,
        median: '2100000.25',
        avg: '2100000.25',
        smallSample: true,
      }),
    );
    // JPY has no minor unit: avg 24800000 / 3 = 8266666.67 -> rounded to 8266667
    expect(payByCurrency).toContainEqual(
      expect.objectContaining({
        currency: 'JPY',
        n: 3,
        median: '8000000',
        avg: '8266667',
        min: '7000000',
        max: '9800000',
      }),
    );
  });

  it('normalises to USD with the snapshot in force on the as-of date', async () => {
    const { normalized, fx, missingFxRates } = await get('/summary');
    expect(fx).toMatchObject({ asOfDate: '2026-10-31', reportingCurrency: 'USD' });
    expect(missingFxRates).toBe(0);
    // Converted: 20700, 27600.00575, 46200, 52800, 64680, 80000, 90000, 100000, 120000, 150000.50
    // median = (64680 + 80000) / 2 = 72340; sum = 751980.50575 -> avg 75198.05, total 751980.51
    expect(normalized).toMatchObject({
      currency: 'USD',
      n: 10,
      median: '72340.00',
      avg: '75198.05',
      total: '751980.51',
      min: '20700.00',
      max: '150000.50',
    });
  });
});

describe('GET /analytics/distribution', () => {
  it('groups local-currency statistics by country and currency (expat paid in USD stays separate)', async () => {
    const body = await get('/distribution?dimension=country&currencyMode=local');
    const india = body.rows.filter((r: { key: string }) => r.key === 'IN');
    expect(india.map((r: { currency: string; n: number }) => [r.currency, r.n])).toEqual([
      ['INR', 2],
      ['USD', 1],
    ]);
  });

  it('normalises by department and flags small samples', async () => {
    const body = await get('/distribution?dimension=department&currencyMode=normalized');
    expect(body.rows).toEqual([
      // Engineering: 20700, 27600.00575, 80000, 90000, 100000, 120000, 150000.50 -> median = 4th = 90000
      expect.objectContaining({
        label: 'Engineering',
        currency: 'USD',
        n: 7,
        median: '90000.00',
        smallSample: false,
      }),
      // Finance: 46200, 52800, 64680 -> median 52800, n=3 < 5
      expect.objectContaining({
        label: 'Finance',
        currency: 'USD',
        n: 3,
        median: '52800.00',
        smallSample: true,
      }),
    ]);
  });

  it('validates the dimension', async () => {
    expect((await viewer.get('/api/v1/analytics/distribution?dimension=salary')).status).toBe(400);
  });
});

describe('GET /analytics/histogram', () => {
  it('buckets normalised pay in fixed USD bands with an open-ended top band', async () => {
    const body = await get('/histogram');
    expect(body.buckets).toHaveLength(16);
    expect(body.buckets.at(-1)).toMatchObject({ from: '300000', to: null });
    const counts = body.buckets.map((b: { count: number }) => b.count);
    expect(counts.slice(0, 8)).toEqual([0, 2, 2, 1, 2, 1, 1, 1]);
    expect(counts.reduce((a: number, b: number) => a + b, 0)).toBe(10);
  });

  it('buckets a single currency with readable bounds', async () => {
    const body = await get('/histogram?currency=JPY');
    expect(body).toMatchObject({ currency: 'JPY', normalized: false });
    expect(body.buckets[0]).toEqual({ from: '7000000', to: '7250000', count: 1 });
    expect(body.buckets.reduce((sum: number, b: { count: number }) => sum + b.count, 0)).toBe(3);
  });
});

describe('GET /analytics/trends', () => {
  it('counts the people employed at each month end, including those who have since left', async () => {
    const body = await get('/trends?months=12');
    const at = (date: string) => body.points.find((p: { date: string }) => p.date === date);
    expect(body.points.at(-1)).toMatchObject({ date: '2026-11-19', n: 10, median: '72340.00' });
    expect(at('2026-05-31').n).toBe(11); // J still employed
    expect(at('2026-06-30').n).toBe(10); // J's termination date
    expect(body.points).toHaveLength(12);
  });
});

describe('GET /analytics/recent-changes', () => {
  it('lists salary changes and corrections from the audit trail, newest first', async () => {
    const manager = await loginAs(buildApp().app, 'manager');
    const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeCode: 'EMP-B' } });
    const created = await manager
      .post(`/api/v1/employees/${employee.id}/compensations`)
      .send({
        amount: '130000',
        currencyCode: 'USD',
        effectiveFrom: '2026-04-01',
        reason: 'PROMOTION',
      });
    expect(created.status).toBe(201);
    await manager
      .patch(`/api/v1/employees/${employee.id}/compensations/${created.body.id}`)
      .send({
        version: created.body.version,
        amount: '131000',
        correctionReason: 'Approved figure',
      });

    const { data } = await get('/recent-changes?limit=5');
    expect(data.map((d: { action: string }) => d.action)).toEqual([
      'COMPENSATION_CORRECTED',
      'COMPENSATION_CREATED',
    ]);
    expect(data[0]).toMatchObject({
      employee: { employeeCode: 'EMP-B' },
      before: { amount: '130000.00' },
      after: { amount: '131000.00' },
      correctionReason: 'Approved figure',
      actor: { displayName: 'Test manager' },
    });
  });
});

describe('access', () => {
  it('requires a session', async () => {
    expect((await request(buildApp().app).get('/api/v1/analytics/summary')).status).toBe(401);
  });
});
