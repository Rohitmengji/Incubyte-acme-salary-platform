import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { CompensationService } from '../../src/modules/compensation/compensation.service.ts';
import { FixedClock } from '../../src/lib/clock.ts';
import {
  auditActions,
  buildApp,
  employeePayload,
  loginAs,
  prisma,
  resetDatabase,
  TEST_NOW,
} from './helpers.ts';

let manager: TestAgent;
let employeeId: string;
const comp = () => `/api/v1/employees/${employeeId}/compensations`;

/** Employee hired 2022-03-01 on INR 1,800,000; "today" in tests is 2026-11-19. */
beforeEach(async () => {
  await resetDatabase();
  manager = await loginAs(buildApp().app, 'manager');
  const res = await manager.post('/api/v1/employees').send(employeePayload());
  employeeId = res.body.id;
});
afterAll(() => prisma.$disconnect());

async function history() {
  const res = await manager.get(comp());
  expect(res.status).toBe(200);
  return res.body.data as {
    id: string;
    amount: string;
    currency: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    isCurrent: boolean;
    version: number;
  }[];
}

async function addChange(body: Record<string, unknown>) {
  return manager.post(comp()).send({ currencyCode: 'INR', reason: 'ANNUAL_REVIEW', ...body });
}

describe('salary history and changes', () => {
  it('shows history newest first and marks the period in effect today', async () => {
    await addChange({ amount: '2000000', effectiveFrom: '2024-04-01' });
    const rows = await history();
    expect(rows.map((r) => [r.effectiveFrom, r.effectiveTo, r.amount, r.isCurrent])).toEqual([
      ['2024-04-01', null, '2000000.00', true],
      ['2022-03-01', '2024-04-01', '1800000.00', false],
    ]);
  });

  it('closes the previous period when a change is added, and audits both rows in one transaction', async () => {
    const res = await addChange({
      amount: '2000000.50',
      effectiveFrom: '2024-04-01',
      note: 'FY24 review',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      amount: '2000000.50',
      currency: 'INR',
      reason: 'ANNUAL_REVIEW',
      note: 'FY24 review',
    });
    expect(res.body.createdBy.displayName).toBe('Test manager');

    expect(await auditActions(employeeId)).toEqual([
      'EMPLOYEE_CREATED',
      'COMPENSATION_CREATED',
      'COMPENSATION_PERIOD_ADJUSTED',
      'COMPENSATION_CREATED',
    ]);
    const adjusted = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'COMPENSATION_PERIOD_ADJUSTED' },
    });
    expect(adjusted.changes).toMatchObject({
      before: { effectiveTo: null },
      after: { effectiveTo: '2024-04-01' },
    });
  });

  it('supports future-dated (scheduled) raises without changing the current salary yet', async () => {
    await addChange({ amount: '2100000', effectiveFrom: '2027-01-01' });
    const rows = await history();
    expect(rows[0]).toMatchObject({ effectiveFrom: '2027-01-01', isCurrent: false });
    expect(rows[1]).toMatchObject({
      effectiveFrom: '2022-03-01',
      effectiveTo: '2027-01-01',
      isCurrent: true,
    });
    const employee = await manager.get(`/api/v1/employees/${employeeId}`);
    expect(employee.body.currentCompensation.amount).toBe('1800000.00');
  });

  it('inserts a late-entered change between existing periods without overlap or gap', async () => {
    await addChange({ amount: '2100000', effectiveFrom: '2027-01-01' });
    await addChange({ amount: '1950000', effectiveFrom: '2025-04-01' });
    const rows = await history();
    expect(rows.map((r) => [r.effectiveFrom, r.effectiveTo])).toEqual([
      ['2027-01-01', null],
      ['2025-04-01', '2027-01-01'],
      ['2022-03-01', '2025-04-01'],
    ]);
  });

  it('rejects a second period on the same start date, dates before hire and inactive employees', async () => {
    const taken = await addChange({ amount: '1', effectiveFrom: '2022-03-01' });
    expect(taken.status).toBe(409);
    expect(taken.body.errors[0].path).toBe('effectiveFrom');

    expect((await addChange({ amount: '1', effectiveFrom: '2022-02-28' })).status).toBe(422);

    await manager
      .post(`/api/v1/employees/${employeeId}/deactivate`)
      .send({ version: 1, terminationDate: '2026-10-31', reason: 'Left' });
    const inactive = await addChange({ amount: '1', effectiveFrom: '2026-11-01' });
    expect(inactive.status).toBe(422);
    expect(inactive.body.detail).toMatch(/inactive/);
    expect(await prisma.compensation.count()).toBe(1);
  });

  it('enforces currency precision and supports switching pay currency', async () => {
    const yen = await addChange({
      amount: '9800000.5',
      currencyCode: 'JPY',
      effectiveFrom: '2025-01-01',
    });
    expect(yen.status).toBe(422);
    const usd = await addChange({
      amount: '42000',
      currencyCode: 'usd',
      effectiveFrom: '2025-01-01',
      reason: 'ROLE_CHANGE',
    });
    expect(usd.body).toMatchObject({ amount: '42000.00', currency: 'USD' });
  });

  it('lets viewers read salary history but not change it', async () => {
    const viewer = await loginAs(buildApp().app, 'viewer');
    expect((await viewer.get(comp())).status).toBe(200);
    const [original] = await history();
    expect(
      (
        await viewer
          .post(comp())
          .send({ amount: '1', currencyCode: 'INR', effectiveFrom: '2025-01-01', reason: 'OTHER' })
      ).status,
    ).toBe(403);
    expect(
      (
        await viewer
          .patch(`${comp()}/${original!.id}`)
          .send({ version: 1, amount: '1', correctionReason: 'Nope' })
      ).status,
    ).toBe(403);
  });

  it('returns 404 for unknown employees', async () => {
    const res = await manager.get(
      '/api/v1/employees/0190a8f0-0000-7000-8000-000000000001/compensations',
    );
    expect(res.status).toBe(404);
  });
});

describe('salary corrections', () => {
  it('corrects an amount, bumps the version and records before/after with the reason', async () => {
    const [original] = await history();
    const res = await manager.patch(`${comp()}/${original!.id}`).send({
      version: original!.version,
      amount: '1850000',
      correctionReason: 'Offer letter typo',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ amount: '1850000.00', version: 2 });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'COMPENSATION_CORRECTED' },
    });
    expect(audit.changes).toEqual({
      before: { amount: '1800000.00' },
      after: { amount: '1850000.00' },
      correctionReason: 'Offer letter typo',
    });
  });

  it('rejects stale versions', async () => {
    const [original] = await history();
    const body = { version: 1, amount: '1850000', correctionReason: 'First fix' };
    expect((await manager.patch(`${comp()}/${original!.id}`).send(body)).status).toBe(200);
    const stale = await manager
      .patch(`${comp()}/${original!.id}`)
      .send({ ...body, amount: '1900000' });
    expect(stale.status).toBe(409);
    expect(stale.body.type).toMatch(/stale-version$/);
  });

  it('moves a start date and drags the previous end date with it (no gap, no overlap)', async () => {
    await addChange({ amount: '2000000', effectiveFrom: '2024-04-01' });
    const [latest] = await history();
    const later = await manager.patch(`${comp()}/${latest!.id}`).send({
      version: latest!.version,
      effectiveFrom: '2024-07-01',
      correctionReason: 'Review was approved late',
    });
    expect(later.status).toBe(200);
    expect((await history()).map((r) => [r.effectiveFrom, r.effectiveTo])).toEqual([
      ['2024-07-01', null],
      ['2022-03-01', '2024-07-01'],
    ]);
  });

  it('refuses to move a start date past a neighbour', async () => {
    await addChange({ amount: '2000000', effectiveFrom: '2024-04-01' });
    const [latest] = await history();
    const res = await manager
      .patch(`${comp()}/${latest!.id}`)
      .send({ version: latest!.version, effectiveFrom: '2022-01-01', correctionReason: 'Wrong' });
    expect(res.status).toBe(422);
  });

  it('rejects a currency switch that the existing amount cannot represent', async () => {
    const [original] = await history();
    await manager
      .patch(`${comp()}/${original!.id}`)
      .send({ version: 1, amount: '1800000.50', correctionReason: 'Paise' });
    const res = await manager
      .patch(`${comp()}/${original!.id}`)
      .send({ version: 2, currencyCode: 'JPY', correctionReason: 'Wrong currency' });
    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toEqual({
      path: 'amount',
      message: 'JPY amounts must be whole numbers',
    });
  });

  it('treats an identical correction as a no-op: no version bump, no audit row', async () => {
    const [original] = await history();
    const res = await manager
      .patch(`${comp()}/${original!.id}`)
      .send({ version: 1, amount: '1800000.00', correctionReason: 'Double-check' });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(await auditActions(employeeId)).not.toContain('COMPENSATION_CORRECTED');
  });

  it('requires a correction reason', async () => {
    const [original] = await history();
    expect(
      (await manager.patch(`${comp()}/${original!.id}`).send({ version: 1, amount: '1' })).status,
    ).toBe(400);
  });
});

describe('concurrency and atomicity', () => {
  it('serialises concurrent changes for one employee so the timeline stays contiguous', async () => {
    const dates = ['2023-01-01', '2023-06-01', '2024-01-01', '2024-06-01', '2025-01-01'];
    const results = await Promise.all(
      dates.map((effectiveFrom) => addChange({ amount: '2000000', effectiveFrom })),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);

    const rows = (await history()).reverse();
    expect(rows).toHaveLength(6);
    rows.forEach((row, i) => expect(row.effectiveTo).toBe(rows[i + 1]?.effectiveFrom ?? null));
  });

  it('lets exactly one of two simultaneous changes for the same date win (double submit)', async () => {
    const [a, b] = await Promise.all([
      addChange({ amount: '2000000', effectiveFrom: '2024-04-01' }),
      addChange({ amount: '2000000', effectiveFrom: '2024-04-01' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await prisma.compensation.count({ where: { employeeId } })).toBe(2);
  });

  it('rolls back every write when a later step in the transaction fails', async () => {
    // An actor that does not exist makes the audit insert (the last step) fail its foreign key,
    // after the previous period has already been shortened inside the transaction.
    const service = new CompensationService(prisma, new FixedClock(TEST_NOW));
    const ghost = { userId: '0190a8f0-0000-7000-8000-00000000dead', requestId: 'test' };
    await expect(
      service.create(ghost, employeeId, {
        amount: '2000000',
        currencyCode: 'INR',
        effectiveFrom: '2024-04-01',
        reason: 'ANNUAL_REVIEW',
      }),
    ).rejects.toThrow();

    const rows = await history();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.effectiveTo).toBeNull();
    expect(rows[0]!.version).toBe(1);
  });
});
