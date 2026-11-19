import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase, SEED_USERS } from '../../prisma/seed/seed.ts';
import { buildApp, prisma } from './helpers.ts';

describe('seedDatabase', () => {
  const options = {
    count: 300,
    managerPassword: 'Seed-Manager-1',
    viewerPassword: 'Seed-Viewer-1',
  };

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE audit_log, session, compensation, employee, exchange_rate, app_user, job_title, department, country, currency RESTART IDENTITY CASCADE`,
    );
  });
  afterAll(() => prisma.$disconnect());

  it('is idempotent: a second run inserts nothing and changes no totals', async () => {
    const first = await seedDatabase(prisma, options);
    expect(first.employeesInserted).toBe(300);
    expect(first.seededEmployeesPresent).toBe(300);
    const totalsAfterFirst = await Promise.all([
      prisma.employee.count(),
      prisma.compensation.count(),
      prisma.exchangeRate.count(),
    ]);

    const second = await seedDatabase(prisma, options);
    expect(second).toEqual({
      employeesInserted: 0,
      compensationsInserted: 0,
      seededEmployeesPresent: 300,
    });
    expect(
      await Promise.all([
        prisma.employee.count(),
        prisma.compensation.count(),
        prisma.exchangeRate.count(),
      ]),
    ).toEqual(totalsAfterFirst);
  });

  it('writes timelines that satisfy the database constraints and are contiguous', async () => {
    const broken = await prisma.$queryRaw<{ n: number }[]>`
      WITH ordered AS (
        SELECT effective_to, lead(effective_from) OVER (PARTITION BY employee_id ORDER BY effective_from) AS next_start
        FROM compensation)
      SELECT count(*)::int AS n FROM ordered WHERE effective_to IS DISTINCT FROM next_start`;
    expect(broken[0]!.n).toBe(0);
  });

  it('creates demo users who can sign in with the configured passwords', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: SEED_USERS.manager.email, password: options.managerPassword });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('HR_MANAGER');
  });
});
