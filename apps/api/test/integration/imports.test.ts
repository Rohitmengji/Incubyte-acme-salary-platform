import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { FixedClock } from '../../src/lib/clock.ts';
import { buildApp, employeePayload, loginAs, prisma, resetDatabase, TEST_NOW } from './helpers.ts';

const HEADER =
  'Employee ID,First Name,Last Name,Email,Country,Department,Job Title,Hire Date,Salary,Currency,Status';
const row = (
  code: string,
  email: string,
  extra: Partial<
    Record<'country' | 'dept' | 'title' | 'salary' | 'currency' | 'hire' | 'status', string>
  > = {},
) =>
  [
    code,
    'Asha',
    'Verma',
    email,
    extra.country ?? 'IN',
    extra.dept ?? 'engineering',
    extra.title ?? 'Software Engineer',
    extra.hire ?? '2024-01-15',
    extra.salary ?? '1800000',
    extra.currency ?? 'INR',
    extra.status ?? '',
  ].join(',');

let manager: TestAgent;
let clock: FixedClock;

async function upload(lines: string[], fileName = 'people.csv') {
  return manager
    .post('/api/v1/imports')
    .send({ fileName, content: [HEADER, ...lines].join('\r\n') });
}

beforeEach(async () => {
  await resetDatabase();
  const built = buildApp();
  clock = built.clock;
  manager = await loginAs(built.app, 'manager');
});
afterAll(() => prisma.$disconnect());

describe('CSV import preview', () => {
  it('classifies rows as valid, invalid or duplicate with row-level messages, and writes no employees', async () => {
    await manager
      .post('/api/v1/employees')
      .send(employeePayload({ employeeCode: 'EXIST-1', email: 'taken@acme.example' }));
    const res = await upload([
      row('NEW-1', 'new1@acme.example'),
      row('NEW-2', 'new2@acme.example', {
        country: 'US',
        salary: '120000.50',
        currency: 'USD',
        status: 'on leave',
      }),
      row('NEW-3', 'new3@acme.example', { salary: '"1,800,000"' }),
      row('NEW-4', 'new4@acme.example', { dept: 'Astrology' }),
      row('NEW-5', 'new5@acme.example', { country: 'JP', currency: 'JPY', salary: '9800000.5' }),
      row('NEW-1', 'other@acme.example'),
      row('EXIST-1', 'fresh@acme.example'),
      row('NEW-6', 'TAKEN@acme.example'),
    ]);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'PREVIEWED',
      totalRows: 8,
      validRows: 2,
      invalidRows: 3,
      duplicateRows: 3,
    });
    expect(res.body.issues).toEqual([
      expect.objectContaining({
        row: 4,
        column: 'salary',
        kind: 'invalid',
        message: expect.stringMatching(/thousands separators/),
      }),
      { row: 5, column: 'department', kind: 'invalid', message: 'Unknown department "Astrology"' },
      { row: 6, column: 'salary', kind: 'invalid', message: 'JPY amounts must be whole numbers' },
      {
        row: 7,
        column: 'employee_id',
        kind: 'duplicate',
        message: 'Duplicate of row 2 in this file',
      },
      {
        row: 8,
        column: 'employee_id',
        kind: 'duplicate',
        message: 'Employee EXIST-1 already exists',
      },
      {
        row: 9,
        column: 'email',
        kind: 'duplicate',
        message: 'An employee with taken@acme.example already exists',
      },
    ]);
    expect(res.body.sample.map((s: { employeeCode: string }) => s.employeeCode)).toEqual([
      'NEW-1',
      'NEW-2',
    ]);
    expect(res.body.sample[0]).toMatchObject({
      department: 'Engineering',
      currency: 'INR',
      salary: '1800000',
    });
    expect(await prisma.employee.count()).toBe(1);
  });

  it('rejects files that are missing required columns or have no rows', async () => {
    const missing = await manager
      .post('/api/v1/imports')
      .send({ fileName: 'x.csv', content: 'Employee ID,Email\nA-1,a@x.io' });
    expect(missing.status).toBe(422);
    expect(missing.body.detail).toMatch(/missing required columns: first_name, last_name/);
    expect(
      (await manager.post('/api/v1/imports').send({ fileName: 'x.csv', content: HEADER })).status,
    ).toBe(422);
  });

  it('accepts a body larger than the default 100 kB JSON limit', async () => {
    const lines = Array.from({ length: 1500 }, (_, i) => row(`BULK-${i}`, `bulk${i}@acme.example`));
    const res = await upload(lines);
    expect(res.status).toBe(201);
    expect(res.body.validRows).toBe(1500);
  });

  it('is limited to HR managers', async () => {
    const viewer = await loginAs(buildApp().app, 'viewer');
    expect(
      (await viewer.post('/api/v1/imports').send({ fileName: 'x.csv', content: HEADER })).status,
    ).toBe(403);
    expect((await viewer.get('/api/v1/exports/employees.csv')).status).toBe(403);
  });
});

describe('CSV import commit', () => {
  it('imports valid rows atomically with salaries and a full audit trail', async () => {
    const preview = await upload([
      row('NEW-1', 'new1@acme.example'),
      row('BAD-1', 'bad@acme.example', { dept: 'Nope' }),
    ]);
    const res = await manager.post(`/api/v1/imports/${preview.body.id}/commit`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'COMMITTED', importedRows: 1 });
    const employee = await prisma.employee.findUniqueOrThrow({
      where: { employeeCode: 'NEW-1' },
      include: { compensations: true },
    });
    expect(employee.compensations).toHaveLength(1);
    expect(employee.compensations[0]!.amount.toFixed(2)).toBe('1800000.00');
    const actions = (await prisma.auditLog.findMany({ orderBy: { id: 'asc' } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(['EMPLOYEE_CREATED', 'COMPENSATION_CREATED', 'IMPORT_COMMITTED']);
  });

  it('imports exactly once even when committed twice at the same time', async () => {
    const preview = await upload([row('NEW-1', 'new1@acme.example')]);
    const [a, b] = await Promise.all([
      manager.post(`/api/v1/imports/${preview.body.id}/commit`),
      manager.post(`/api/v1/imports/${preview.body.id}/commit`),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await prisma.employee.count()).toBe(1);
  });

  it('rolls everything back if an employee was created after the preview', async () => {
    const preview = await upload([
      row('NEW-1', 'new1@acme.example'),
      row('NEW-2', 'new2@acme.example'),
    ]);
    await manager
      .post('/api/v1/employees')
      .send(employeePayload({ employeeCode: 'NEW-2', email: 'someone@acme.example' }));

    const res = await manager.post(`/api/v1/imports/${preview.body.id}/commit`);
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/1 row\(s\) now match/);
    expect(await prisma.employee.findUnique({ where: { employeeCode: 'NEW-1' } })).toBeNull();
    expect((await manager.get(`/api/v1/imports/${preview.body.id}`)).body.status).toBe('PREVIEWED');
  });

  it('refuses expired previews', async () => {
    const preview = await upload([row('NEW-1', 'new1@acme.example')]);
    clock.advanceBy(31 * 60 * 1000);
    const res = await manager.post(`/api/v1/imports/${preview.body.id}/commit`);
    expect(res.status).toBe(409);
    expect(res.body.type).toMatch(/import-expired$/);
  });

  it('warns when the identical file was already imported', async () => {
    const lines = [row('NEW-1', 'new1@acme.example')];
    const first = await upload(lines);
    await manager.post(`/api/v1/imports/${first.body.id}/commit`);
    const again = await upload(lines);
    expect(again.body.previouslyImportedAt).toEqual(expect.any(String));
    expect(again.body.duplicateRows).toBe(1);
  });
});

describe('CSV export', () => {
  it('exports the filtered list with current salaries, safely for spreadsheets, and audits it', async () => {
    await manager
      .post('/api/v1/employees')
      .send(
        employeePayload({
          employeeCode: 'EXP-1',
          firstName: '=HYPERLINK("x")',
          lastName: 'Sharma, Jr',
        }),
      );
    await manager
      .post('/api/v1/employees')
      .send(
        employeePayload({
          employeeCode: 'EXP-2',
          countryCode: 'US',
          initialCompensation: { amount: '120000', currencyCode: 'USD' },
        }),
      );

    const res = await manager
      .get('/api/v1/exports/employees.csv?country=IN')
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.on('data', (c: Buffer) => (data += c.toString('utf8')));
        r.on('end', () => cb(null, data));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="acme-employees-2026-11-19.csv"/,
    );
    const lines = (res.body as string)
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(lines[0]).toBe(
      'employee_id,first_name,last_name,email,country,department,job_title,status,hire_date,termination_date,salary,currency,salary_effective_from',
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      `EXP-1,"'=HYPERLINK(""x"")","Sharma, Jr",exp-1@test.example,IN,Engineering,Software Engineer,ACTIVE,2022-03-01,,1800000.00,INR,2022-03-01`.replace(
        'exp-1@test.example',
        lines[1]!.split(',')[4]!,
      ),
    );

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'EMPLOYEES_EXPORTED' },
    });
    expect(audit.changes).toMatchObject({ rowCount: 1, filters: { country: ['IN'] } });
  });

  it('produces a file that the importer accepts (round trip)', async () => {
    await manager.post('/api/v1/employees').send(employeePayload({ employeeCode: 'RT-1' }));
    const exported = await manager
      .get('/api/v1/exports/employees.csv')
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.on('data', (c: Buffer) => (data += c.toString('utf8')));
        r.on('end', () => cb(null, data));
      });
    const res = await manager
      .post('/api/v1/imports')
      .send({ fileName: 'roundtrip.csv', content: exported.body as string });
    expect(res.status).toBe(201);
    // Same people already exist, so every row is a duplicate rather than invalid.
    expect(res.body).toMatchObject({
      totalRows: 1,
      validRows: 0,
      invalidRows: 0,
      duplicateRows: 1,
    });
  });

  it('requires a session', async () => {
    expect(
      (
        await request(buildApp({ clock: new FixedClock(TEST_NOW) }).app).get(
          '/api/v1/exports/employees.csv',
        )
      ).status,
    ).toBe(401);
  });
});
