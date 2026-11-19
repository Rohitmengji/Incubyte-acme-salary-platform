import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import {
  auditActions,
  buildApp,
  employeePayload,
  loginAs,
  prisma,
  REF,
  resetDatabase,
} from './helpers.ts';

const BASE = '/api/v1/employees';
let manager: TestAgent;

async function create(overrides: Record<string, unknown> = {}) {
  const res = await manager.post(BASE).send(employeePayload(overrides));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

beforeEach(async () => {
  await resetDatabase();
  manager = await loginAs(buildApp().app, 'manager');
});
afterAll(() => prisma.$disconnect());

describe('POST /employees', () => {
  it('creates an employee with an initial salary in one transaction and audits both', async () => {
    const res = await manager.post(BASE).send(
      employeePayload({
        employeeCode: 'emp-000123',
        email: ' Asha.Verma@ACME.example ',
        initialCompensation: { amount: '1800000.5', currencyCode: 'inr' },
      }),
    );

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`${BASE}/${res.body.id}`);
    expect(res.body).toMatchObject({
      employeeCode: 'EMP-000123',
      email: 'asha.verma@acme.example',
      status: 'ACTIVE',
      hireDate: '2022-03-01',
      terminationDate: null,
      version: 1,
      country: { code: 'IN', name: 'India' },
      department: { id: REF.engineering, name: 'Engineering' },
      currentCompensation: { amount: '1800000.50', currency: 'INR', effectiveFrom: '2022-03-01' },
    });
    expect(await auditActions(res.body.id)).toEqual(['EMPLOYEE_CREATED', 'COMPENSATION_CREATED']);
  });

  it('rejects duplicate employee IDs and emails with field-level 409s and writes nothing', async () => {
    const first = await create({ employeeCode: 'DUP-001', email: 'dup@test.example' });
    const auditBefore = await prisma.auditLog.count();

    const sameCode = await manager.post(BASE).send(employeePayload({ employeeCode: 'dup-001' }));
    expect(sameCode.status).toBe(409);
    expect(sameCode.body.errors).toEqual([
      { path: 'employeeCode', message: 'An employee with this ID already exists' },
    ]);

    const sameEmail = await manager.post(BASE).send(employeePayload({ email: 'DUP@test.example' }));
    expect(sameEmail.status).toBe(409);
    expect(sameEmail.body.errors[0].path).toBe('email');

    expect(await prisma.employee.count()).toBe(1);
    expect(await prisma.compensation.count({ where: { employeeId: { not: first.id } } })).toBe(0);
    expect(await prisma.auditLog.count()).toBe(auditBefore);
  });

  it('returns field-level validation errors', async () => {
    const res = await manager.post(BASE).send({
      ...employeePayload(),
      employeeCode: 'x',
      email: 'not-an-email',
      hireDate: '2026-02-30',
      initialCompensation: { amount: '1,800,000', currencyCode: 'INR' },
    });
    expect(res.status).toBe(400);
    const paths = res.body.errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining(['employeeCode', 'email', 'hireDate', 'initialCompensation.amount']),
    );
  });

  it('rejects unknown references, unsupported precision and salaries before the hire date', async () => {
    const unknownDept = await manager.post(BASE).send(employeePayload({ departmentId: 999 }));
    expect(unknownDept.status).toBe(422);
    expect(unknownDept.body.errors).toEqual([
      { path: 'departmentId', message: 'Unknown department' },
    ]);

    const yenFraction = await manager.post(BASE).send(
      employeePayload({
        countryCode: 'JP',
        initialCompensation: { amount: '9800000.5', currencyCode: 'JPY' },
      }),
    );
    expect(yenFraction.status).toBe(422);
    expect(yenFraction.body.errors[0]).toEqual({
      path: 'initialCompensation.amount',
      message: 'JPY amounts must be whole numbers',
    });

    const early = await manager.post(BASE).send(
      employeePayload({
        initialCompensation: { amount: '100', currencyCode: 'INR', effectiveFrom: '2022-02-28' },
      }),
    );
    expect(early.status).toBe(422);
    expect(await prisma.employee.count()).toBe(0);
  });

  it('allows a pay currency that differs from the country default (e.g. an expat paid in USD)', async () => {
    const body = await create({
      countryCode: 'IN',
      initialCompensation: { amount: '95000', currencyCode: 'USD' },
    });
    expect(body.currentCompensation).toMatchObject({ amount: '95000.00', currency: 'USD' });
  });
});

describe('GET /employees', () => {
  beforeEach(async () => {
    await create({
      employeeCode: 'EMP-1',
      firstName: 'Priya',
      lastName: 'Sharma',
      hireDate: '2021-01-10',
    });
    await create({
      employeeCode: 'EMP-2',
      firstName: 'Rahul',
      lastName: 'Sharma',
      hireDate: '2020-05-01',
      departmentId: REF.finance,
      jobTitleId: REF.accountant,
    });
    await create({
      employeeCode: 'EMP-3',
      firstName: 'Kenji',
      lastName: 'Sato',
      countryCode: 'JP',
      hireDate: '2019-07-15',
      initialCompensation: { amount: '9800000', currencyCode: 'JPY' },
    });
    await create({
      employeeCode: 'EMP-4',
      firstName: 'Emma',
      lastName: 'Brown',
      countryCode: 'US',
      hireDate: '2023-02-01',
      status: 'ON_LEAVE',
      initialCompensation: { amount: '120000', currencyCode: 'USD' },
    });
    await create({
      employeeCode: 'EMP-5',
      firstName: 'Literal',
      lastName: 'Wild_card%',
      hireDate: '2024-01-01',
    });
  });

  const codes = (body: { data: { employeeCode: string }[] }) =>
    body.data.map((e) => e.employeeCode);

  it('paginates on the server with stable totals and no overlap between pages', async () => {
    const page1 = await manager.get(BASE).query({ pageSize: 2, page: 1 });
    const page2 = await manager.get(BASE).query({ pageSize: 2, page: 2 });
    const page3 = await manager.get(BASE).query({ pageSize: 2, page: 3 });
    expect(page1.body).toMatchObject({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
    const all = [...codes(page1.body), ...codes(page2.body), ...codes(page3.body)];
    expect(new Set(all).size).toBe(5);
    expect((await manager.get(BASE).query({ page: 99 })).body.data).toEqual([]);
  });

  it('includes the current salary for each employee on the page', async () => {
    const res = await manager.get(BASE).query({ search: 'kenji' });
    expect(res.body.data[0].currentCompensation).toEqual({
      amount: '9800000',
      currency: 'JPY',
      effectiveFrom: '2019-07-15',
    });
  });

  it('searches names and employee IDs case-insensitively, requiring every word to match', async () => {
    expect(codes((await manager.get(BASE).query({ search: 'sharma' })).body).sort()).toEqual([
      'EMP-1',
      'EMP-2',
    ]);
    expect(codes((await manager.get(BASE).query({ search: 'PRIYA sha' })).body)).toEqual(['EMP-1']);
    expect(codes((await manager.get(BASE).query({ search: 'emp-3' })).body)).toEqual(['EMP-3']);
    expect((await manager.get(BASE).query({ search: 'nobody' })).body.total).toBe(0);
  });

  it('treats % and _ in search as literal characters', async () => {
    expect(codes((await manager.get(BASE).query({ search: '%' })).body)).toEqual(['EMP-5']);
    expect(codes((await manager.get(BASE).query({ search: '_' })).body)).toEqual(['EMP-5']);
  });

  it('filters by country, department, job title and status, alone and combined', async () => {
    expect(codes((await manager.get(BASE).query({ country: 'JP' })).body)).toEqual(['EMP-3']);
    expect(codes((await manager.get(BASE).query({ country: 'JP,US' })).body).sort()).toEqual([
      'EMP-3',
      'EMP-4',
    ]);
    expect(codes((await manager.get(BASE).query({ department: REF.finance })).body)).toEqual([
      'EMP-2',
    ]);
    expect(codes((await manager.get(BASE).query({ jobTitle: REF.accountant })).body)).toEqual([
      'EMP-2',
    ]);
    expect(codes((await manager.get(BASE).query({ status: 'ON_LEAVE' })).body)).toEqual(['EMP-4']);
    expect(
      codes(
        (await manager.get(BASE).query({ search: 'sharma', department: REF.engineering })).body,
      ),
    ).toEqual(['EMP-1']);
  });

  it('sorts by name (with tiebreaks) and by hire date in both directions', async () => {
    const byName = codes((await manager.get(BASE).query({ sort: 'name' })).body);
    expect(byName).toEqual(['EMP-4', 'EMP-3', 'EMP-1', 'EMP-2', 'EMP-5']);
    const byHireDesc = codes(
      (await manager.get(BASE).query({ sort: 'hireDate', order: 'desc' })).body,
    );
    expect(byHireDesc).toEqual(['EMP-5', 'EMP-4', 'EMP-1', 'EMP-2', 'EMP-3']);
    const byCountry = codes((await manager.get(BASE).query({ sort: 'country' })).body);
    expect(byCountry[0]).toBe('EMP-1'); // India before Japan before United States
    expect(byCountry.at(-1)).toBe('EMP-4');
  });

  it('rejects invalid query parameters', async () => {
    expect((await manager.get(BASE).query({ pageSize: 1000 })).status).toBe(400);
    expect((await manager.get(BASE).query({ sort: 'salary' })).status).toBe(400);
    expect((await manager.get(BASE).query({ status: 'FIRED' })).status).toBe(400);
  });
});

describe('GET /employees/:id', () => {
  it('returns 404 for unknown and malformed IDs', async () => {
    expect((await manager.get(`${BASE}/0190a8f0-0000-7000-8000-000000000001`)).status).toBe(404);
    expect((await manager.get(`${BASE}/not-a-uuid`)).status).toBe(404);
  });
});

describe('PATCH /employees/:id', () => {
  it('updates only the provided fields, bumps the version and audits the diff', async () => {
    const employee = await create();
    const res = await manager
      .patch(`${BASE}/${employee.id}`)
      .send({ version: 1, lastName: 'Iyer', departmentId: REF.finance });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      lastName: 'Iyer',
      firstName: 'Asha',
      department: { name: 'Finance' },
      version: 2,
    });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { employeeId: employee.id, action: 'EMPLOYEE_UPDATED' },
    });
    expect(audit.changes).toEqual({
      before: { lastName: 'Verma', departmentId: REF.engineering },
      after: { lastName: 'Iyer', departmentId: REF.finance },
    });
  });

  it('rejects stale versions so concurrent edits are not silently lost', async () => {
    const employee = await create();
    expect(
      (await manager.patch(`${BASE}/${employee.id}`).send({ version: 1, firstName: 'A' })).status,
    ).toBe(200);
    const stale = await manager
      .patch(`${BASE}/${employee.id}`)
      .send({ version: 1, firstName: 'B' });
    expect(stale.status).toBe(409);
    expect(stale.body.type).toMatch(/stale-version$/);
    expect((await manager.get(`${BASE}/${employee.id}`)).body.firstName).toBe('A');
  });

  it('does not bump the version or audit when nothing changes', async () => {
    const employee = await create();
    const res = await manager
      .patch(`${BASE}/${employee.id}`)
      .send({ version: 1, firstName: 'Asha' });
    expect(res.body.version).toBe(1);
    expect(await auditActions(employee.id)).not.toContain('EMPLOYEE_UPDATED');
  });

  it('keeps the hire date on or before the first salary period', async () => {
    const employee = await create({ hireDate: '2022-03-01' });
    const res = await manager
      .patch(`${BASE}/${employee.id}`)
      .send({ version: 1, hireDate: '2022-04-01' });
    expect(res.status).toBe(422);
    expect(res.body.errors[0].path).toBe('hireDate');
  });

  it('rejects unknown fields such as the immutable employee ID', async () => {
    const employee = await create();
    expect(
      (await manager.patch(`${BASE}/${employee.id}`).send({ version: 1, employeeCode: 'NEW-1' }))
        .status,
    ).toBe(400);
  });
});

describe('deactivate and reactivate', () => {
  it('deactivates with a termination date and reason, then undoes it; both audited', async () => {
    const employee = await create();
    const deactivated = await manager
      .post(`${BASE}/${employee.id}/deactivate`)
      .send({ version: 1, terminationDate: '2026-10-31', reason: 'Resigned' });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body).toMatchObject({
      status: 'INACTIVE',
      terminationDate: '2026-10-31',
      version: 2,
    });

    const again = await manager
      .post(`${BASE}/${employee.id}/deactivate`)
      .send({ version: 2, terminationDate: '2026-10-31', reason: 'Resigned' });
    expect(again.status).toBe(409);

    const reactivated = await manager
      .post(`${BASE}/${employee.id}/reactivate`)
      .send({ version: 2, reason: 'Deactivated by mistake' });
    expect(reactivated.body).toMatchObject({ status: 'ACTIVE', terminationDate: null, version: 3 });

    const events = await manager.get(`${BASE}/${employee.id}/audit-events`);
    expect(events.body.data.map((e: { action: string }) => e.action)).toEqual([
      'EMPLOYEE_REACTIVATED',
      'EMPLOYEE_DEACTIVATED',
      'COMPENSATION_CREATED',
      'EMPLOYEE_CREATED',
    ]);
    expect(events.body.data[1].changes.reason).toBe('Resigned');
    expect(events.body.data[0].actor.displayName).toBe('Test manager');
  });

  it('rejects a termination date before the hire date', async () => {
    const employee = await create({ hireDate: '2022-03-01' });
    const res = await manager
      .post(`${BASE}/${employee.id}/deactivate`)
      .send({ version: 1, terminationDate: '2022-02-01', reason: 'Typo' });
    expect(res.status).toBe(422);
  });

  it('blocks direct status changes on an inactive employee', async () => {
    const employee = await create();
    await manager
      .post(`${BASE}/${employee.id}/deactivate`)
      .send({ version: 1, terminationDate: '2026-10-31', reason: 'Left' });
    expect(
      (await manager.patch(`${BASE}/${employee.id}`).send({ version: 2, status: 'ACTIVE' })).status,
    ).toBe(422);
  });
});

describe('GET /reference-data', () => {
  beforeAll(() => undefined);

  it('lists the options the UI needs for filters and forms', async () => {
    const res = await manager.get('/api/v1/reference-data');
    expect(res.body.countries.map((c: { code: string }) => c.code)).toEqual([
      'DE',
      'IN',
      'JP',
      'US',
    ]);
    expect(res.body.currencies).toContainEqual({
      code: 'JPY',
      name: 'Japanese Yen',
      minorUnits: 0,
    });
    expect(res.body.statuses).toEqual(['ACTIVE', 'ON_LEAVE', 'INACTIVE']);
  });
});

describe('role-based access', () => {
  it('requires a session for every employee endpoint', async () => {
    const { app } = buildApp();
    expect((await request(app).get(BASE)).status).toBe(401);
    expect((await request(app).get('/api/v1/reference-data')).status).toBe(401);
  });

  it('lets viewers read but not write', async () => {
    const employee = await create();
    const viewer = await loginAs(buildApp().app, 'viewer');
    expect((await viewer.get(BASE)).status).toBe(200);
    expect((await viewer.get(`${BASE}/${employee.id}`)).status).toBe(200);
    expect((await viewer.get(`${BASE}/${employee.id}/audit-events`)).status).toBe(200);
    expect((await viewer.post(BASE).send(employeePayload())).status).toBe(403);
    expect(
      (await viewer.patch(`${BASE}/${employee.id}`).send({ version: 1, firstName: 'X' })).status,
    ).toBe(403);
    expect((await viewer.post(`${BASE}/${employee.id}/deactivate`).send({})).status).toBe(403);
  });
});
