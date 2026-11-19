import request from 'supertest';
import type { Express } from 'express';
import { createApp, createLogger } from '../../src/app.ts';
import { loadConfig, type AppConfig } from '../../src/config.ts';
import { createPrismaClient } from '../../src/db.ts';
import { FixedClock } from '../../src/lib/clock.ts';
import { hashPassword } from '../../src/modules/auth/crypto.ts';

export const prisma = createPrismaClient(process.env.DATABASE_URL!);

/** Fixed "now" for deterministic current-salary and session-expiry behaviour. */
export const TEST_NOW = '2026-11-19T10:00:00.000Z';
export const TEST_TODAY = '2026-11-19';
export const WEB_ORIGIN = 'http://localhost:3000';

export const USERS = {
  manager: {
    email: 'manager@test.example',
    password: 'Manager-Test-Pass-1',
    role: 'HR_MANAGER' as const,
  },
  viewer: {
    email: 'viewer@test.example',
    password: 'Viewer-Test-Pass-1',
    role: 'HR_VIEWER' as const,
  },
};

export const REF = {
  engineering: 1,
  finance: 2,
  softwareEngineer: 1,
  accountant: 2,
};

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: process.env.DATABASE_URL,
    WEB_ORIGIN,
    LOGIN_RATE_LIMIT: '1000',
    API_RATE_LIMIT_PER_MINUTE: '100000',
    ...overrides,
  });
}

export function buildApp(options: { config?: Record<string, string>; clock?: FixedClock } = {}) {
  const clock = options.clock ?? new FixedClock(TEST_NOW);
  const app = createApp({
    config: testConfig(options.config),
    prisma,
    clock,
    logger: createLogger('silent'),
  });
  return { app, clock };
}

let passwordHashes: Promise<Record<keyof typeof USERS, string>> | undefined;

/** Empties every table and inserts a small, known reference dataset plus one user per role. */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE audit_log, session, compensation, employee, exchange_rate, app_user, job_title, department, country, currency RESTART IDENTITY CASCADE`,
  );
  await prisma.currency.createMany({
    data: [
      { code: 'USD', name: 'US Dollar', minorUnits: 2 },
      { code: 'INR', name: 'Indian Rupee', minorUnits: 2 },
      { code: 'JPY', name: 'Japanese Yen', minorUnits: 0 },
      { code: 'EUR', name: 'Euro', minorUnits: 2 },
    ],
  });
  await prisma.country.createMany({
    data: [
      { code: 'US', name: 'United States', defaultCurrencyCode: 'USD' },
      { code: 'IN', name: 'India', defaultCurrencyCode: 'INR' },
      { code: 'JP', name: 'Japan', defaultCurrencyCode: 'JPY' },
      { code: 'DE', name: 'Germany', defaultCurrencyCode: 'EUR' },
    ],
  });
  await prisma.department.createMany({ data: [{ name: 'Engineering' }, { name: 'Finance' }] });
  await prisma.jobTitle.createMany({
    data: [{ name: 'Software Engineer' }, { name: 'Accountant' }],
  });

  passwordHashes ??= (async () => ({
    manager: await hashPassword(USERS.manager.password),
    viewer: await hashPassword(USERS.viewer.password),
  }))();
  const hashes = await passwordHashes;
  await prisma.appUser.createMany({
    data: (Object.keys(USERS) as (keyof typeof USERS)[]).map((key) => ({
      email: USERS[key].email,
      displayName: `Test ${key}`,
      role: USERS[key].role,
      passwordHash: hashes[key],
    })),
  });
}

export async function loginAs(app: Express, role: keyof typeof USERS) {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .send({ email: USERS[role].email, password: USERS[role].password });
  if (res.status !== 200)
    throw new Error(`Login as ${role} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

let counter = 0;

export function employeePayload(overrides: Record<string, unknown> = {}) {
  counter += 1;
  const code = `T-${String(counter).padStart(5, '0')}`;
  return {
    employeeCode: code,
    firstName: 'Asha',
    lastName: 'Verma',
    email: `${code.toLowerCase()}@test.example`,
    countryCode: 'IN',
    departmentId: REF.engineering,
    jobTitleId: REF.softwareEngineer,
    hireDate: '2022-03-01',
    initialCompensation: { amount: '1800000.00', currencyCode: 'INR' },
    ...overrides,
  };
}

export async function auditActions(employeeId: string): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({ where: { employeeId }, orderBy: { id: 'asc' } });
  return rows.map((row) => row.action);
}
