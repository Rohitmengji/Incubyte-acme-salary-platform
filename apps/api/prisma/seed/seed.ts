import { hashPassword } from '../../src/modules/auth/crypto.ts';
import type { PrismaClient } from '../../src/db.ts';
import { COUNTRIES, CURRENCIES, DEPARTMENTS, FX_SNAPSHOT } from './data.ts';
import { generateEmployees } from './generator.ts';

export interface SeedOptions {
  count: number;
  managerPassword: string;
  viewerPassword: string;
  chunkSize?: number;
  log?: (message: string) => void;
}

export interface SeedResult {
  employeesInserted: number;
  compensationsInserted: number;
  seededEmployeesPresent: number;
}

/** The local demo passwords shipped in .env.example; never acceptable outside development. */
export const DEMO_PASSWORDS = ['Manager-Demo-2026!', 'Viewer-Demo-2026!'];

/**
 * In production each seeded account must have its own non-demo password of at least 12 characters.
 * A public demo on synthetic data may opt in to the published demo passwords with
 * ALLOW_DEMO_PASSWORDS=1; any other password must still be at least 12 characters.
 * Returns human-readable problems (empty = OK).
 */
export function seedPasswordProblems(
  env: { NODE_ENV?: string; ALLOW_DEMO_PASSWORDS?: string },
  ...passwords: string[]
): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const allowDemo = env.ALLOW_DEMO_PASSWORDS === '1';
  const problems: string[] = [];
  passwords.forEach((password, i) => {
    const label = i === 0 ? 'SEED_MANAGER_PASSWORD' : 'SEED_VIEWER_PASSWORD';
    if (DEMO_PASSWORDS.includes(password)) {
      if (!allowDemo)
        problems.push(
          `${label} is a published demo password (set ALLOW_DEMO_PASSWORDS=1 only for a public demo on synthetic data).`,
        );
    } else if (password.length < 12)
      problems.push(`${label} must be at least 12 characters in production.`);
  });
  return problems;
}

const date = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export const SEED_USERS = {
  manager: {
    email: 'hr.manager@acme.example',
    displayName: 'Hannah Reyes (HR Manager)',
    role: 'HR_MANAGER',
  },
  viewer: {
    email: 'hr.viewer@acme.example',
    displayName: 'Victor Lam (HR Viewer)',
    role: 'HR_VIEWER',
  },
} as const;

/**
 * Idempotent: reference data is upserted; employees are inserted with skipDuplicates and salary
 * periods are only written for employees inserted in this run, inside the same transaction.
 * Running it again therefore never duplicates rows or touches records edited through the app.
 */
export async function seedDatabase(
  prisma: PrismaClient,
  options: SeedOptions,
): Promise<SeedResult> {
  const { count, chunkSize = 1_000, log = () => {} } = options;

  for (const currency of CURRENCIES) {
    await prisma.currency.upsert({ where: { code: currency.code }, update: {}, create: currency });
  }
  for (const country of COUNTRIES) {
    await prisma.country.upsert({
      where: { code: country.code },
      update: {},
      create: { code: country.code, name: country.name, defaultCurrencyCode: country.currency },
    });
  }
  for (const [currencyCode, rate] of Object.entries(FX_SNAPSHOT.rates)) {
    await prisma.exchangeRate.upsert({
      where: { currencyCode_asOfDate: { currencyCode, asOfDate: date(FX_SNAPSHOT.asOfDate) } },
      update: {},
      create: {
        currencyCode,
        rateToReporting: rate,
        asOfDate: date(FX_SNAPSHOT.asOfDate),
        source: FX_SNAPSHOT.source,
      },
    });
  }
  const departmentIds = new Map<string, number>();
  const jobTitleIds = new Map<string, number>();
  for (const department of DEPARTMENTS) {
    const row = await prisma.department.upsert({
      where: { name: department.name },
      update: {},
      create: { name: department.name },
    });
    departmentIds.set(department.name, row.id);
    for (const title of department.titles) {
      const t = await prisma.jobTitle.upsert({
        where: { name: title.name },
        update: {},
        create: { name: title.name },
      });
      jobTitleIds.set(title.name, t.id);
    }
  }

  for (const [key, user] of Object.entries(SEED_USERS)) {
    const password = key === 'manager' ? options.managerPassword : options.viewerPassword;
    const passwordHash = await hashPassword(password);
    await prisma.appUser.upsert({
      where: { email: user.email },
      // Re-seeding refreshes the demo password but never re-enables a disabled account or restores
      // a changed role: revoking access must survive a routine re-seed.
      update: { passwordHash, displayName: user.displayName },
      create: { ...user, passwordHash },
    });
  }
  log('Reference data, FX snapshot and demo users are in place.');

  const employees = generateEmployees({ count });
  let employeesInserted = 0;
  let compensationsInserted = 0;
  for (let start = 0; start < employees.length; start += chunkSize) {
    const chunk = employees.slice(start, start + chunkSize);
    await prisma.$transaction(
      async (tx) => {
        const inserted = await tx.employee.createManyAndReturn({
          data: chunk.map((e) => ({
            id: e.id,
            employeeCode: e.employeeCode,
            firstName: e.firstName,
            lastName: e.lastName,
            email: e.email,
            countryCode: e.countryCode,
            departmentId: departmentIds.get(e.departmentName)!,
            jobTitleId: jobTitleIds.get(e.jobTitleName)!,
            status: e.status,
            hireDate: date(e.hireDate),
            terminationDate: e.terminationDate ? date(e.terminationDate) : null,
          })),
          skipDuplicates: true,
          select: { id: true },
        });
        const insertedIds = new Set(inserted.map((row) => row.id));
        const periods = chunk
          .filter((e) => insertedIds.has(e.id))
          .flatMap((e) =>
            e.compensations.map((c) => ({
              id: c.id,
              employeeId: e.id,
              amount: c.amount,
              currencyCode: c.currencyCode,
              effectiveFrom: date(c.effectiveFrom),
              effectiveTo: c.effectiveTo ? date(c.effectiveTo) : null,
              reason: c.reason,
            })),
          );
        const created = periods.length
          ? await tx.compensation.createMany({ data: periods })
          : { count: 0 };
        employeesInserted += inserted.length;
        compensationsInserted += created.count;
      },
      { timeout: 60_000 },
    );
    log(
      `Employees ${Math.min(start + chunkSize, employees.length)}/${employees.length} processed.`,
    );
  }

  const seededEmployeesPresent = await prisma.employee.count({
    where: { employeeCode: { in: employees.map((e) => e.employeeCode) } },
  });
  return { employeesInserted, compensationsInserted, seededEmployeesPresent };
}
