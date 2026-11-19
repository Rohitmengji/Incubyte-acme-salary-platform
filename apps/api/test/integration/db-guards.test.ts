import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mapDatabaseError } from '../../src/http/error-handler.ts';
import { prisma, resetDatabase } from './helpers.ts';

/**
 * Prisma's drift detection ignores exclusion constraints, CHECKs and triggers, so a clean
 * `prisma migrate diff` proves nothing about them. These tests prove they exist and work.
 */
describe('database integrity guards', () => {
  let employeeId: string;

  beforeEach(async () => {
    await resetDatabase();
    const employee = await prisma.employee.create({
      data: {
        employeeCode: 'G-001',
        firstName: 'Guard',
        lastName: 'Test',
        email: 'guard@test.example',
        countryCode: 'US',
        departmentId: 1,
        jobTitleId: 1,
        hireDate: new Date('2020-01-01'),
      },
    });
    employeeId = employee.id;
  });

  afterAll(() => prisma.$disconnect());

  it('has the required extensions, constraints and trigger in the catalogue', async () => {
    const extensions = await prisma.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm', 'btree_gist') ORDER BY extname`;
    expect(extensions.map((e) => e.extname)).toEqual(['btree_gist', 'pg_trgm']);

    const exclusion = await prisma.$queryRaw<
      { contype: string; condeferrable: boolean; condeferred: boolean }[]
    >`
      SELECT contype::text AS contype, condeferrable, condeferred FROM pg_constraint WHERE conname = 'compensation_no_overlap_excl'`;
    expect(exclusion).toEqual([{ contype: 'x', condeferrable: true, condeferred: true }]);

    const checks = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint WHERE contype = 'c' ORDER BY conname`;
    expect(checks.map((c) => c.conname)).toEqual(
      expect.arrayContaining([
        'compensation_amount_positive_chk',
        'compensation_period_order_chk',
        'employee_inactive_has_termination_chk',
        'employee_termination_after_hire_chk',
        'employee_email_lowercase_chk',
        'employee_code_format_chk',
      ]),
    );

    const triggers = await prisma.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger WHERE tgrelid = 'audit_log'::regclass AND NOT tgisinternal`;
    expect(triggers.map((t) => t.tgname)).toEqual(['audit_log_append_only']);
  });

  it('rejects overlapping salary periods at commit, even if application rules were bypassed', async () => {
    const error = await prisma
      .$transaction(async (tx) => {
        await tx.compensation.create({
          data: {
            employeeId,
            amount: '100000',
            currencyCode: 'USD',
            effectiveFrom: new Date('2020-01-01'),
            reason: 'NEW_HIRE',
          },
        });
        await tx.compensation.create({
          data: {
            employeeId,
            amount: '110000',
            currencyCode: 'USD',
            effectiveFrom: new Date('2021-01-01'),
            reason: 'ANNUAL_REVIEW',
          },
        });
      })
      .catch((e: unknown) => e);

    expect(mapDatabaseError(error)?.status).toBe(409);
    expect(mapDatabaseError(error)?.slug).toBe('salary-period-overlap');
    expect(await prisma.compensation.count()).toBe(0);
  });

  it('allows a temporary overlap inside a transaction that is resolved before commit', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.compensation.create({
        data: {
          employeeId,
          amount: '100000',
          currencyCode: 'USD',
          effectiveFrom: new Date('2020-01-01'),
          reason: 'NEW_HIRE',
        },
      });
      const second = await tx.compensation.create({
        data: {
          employeeId,
          amount: '110000',
          currencyCode: 'USD',
          effectiveFrom: new Date('2021-01-01'),
          reason: 'ANNUAL_REVIEW',
        },
      });
      await tx.compensation.updateMany({
        where: { employeeId, id: { not: second.id } },
        data: { effectiveTo: new Date('2021-01-01') },
      });
    });
    expect(await prisma.compensation.count()).toBe(2);
  });

  it('rejects non-positive amounts and periods that end before they start', async () => {
    await expect(
      prisma.compensation.create({
        data: {
          employeeId,
          amount: '0',
          currencyCode: 'USD',
          effectiveFrom: new Date('2020-01-01'),
          reason: 'NEW_HIRE',
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.compensation.create({
        data: {
          employeeId,
          amount: '1',
          currencyCode: 'USD',
          effectiveFrom: new Date('2020-01-02'),
          effectiveTo: new Date('2020-01-01'),
          reason: 'NEW_HIRE',
        },
      }),
    ).rejects.toThrow();
  });

  it('requires a termination date for inactive employees', async () => {
    await expect(
      prisma.employee.update({ where: { id: employeeId }, data: { status: 'INACTIVE' } }),
    ).rejects.toThrow();
  });

  it('makes the audit log append-only', async () => {
    const entry = await prisma.auditLog.create({
      data: {
        action: 'TEST',
        entityType: 'EMPLOYEE',
        entityId: employeeId,
        employeeId,
        changes: {},
      },
    });
    await expect(
      prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'TAMPERED' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(
      /append-only/,
    );
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } })).action).toBe(
      'TEST',
    );
  });
});
