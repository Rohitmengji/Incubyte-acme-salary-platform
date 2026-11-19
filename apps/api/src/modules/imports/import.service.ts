import { createHash, randomUUID } from 'node:crypto';
import {
  ASSIGNABLE_STATUSES,
  CSV_MAX_ROWS,
  CSV_REQUIRED_IMPORT_COLUMNS,
  amountSchema,
  countryCodeSchema,
  currencyCodeSchema,
  employeeCodeSchema,
  fitsCurrencyScale,
  isoDateSchema,
  type ImportPreview,
  type ImportRowIssue,
  type ImportSampleRow,
  type ImportUpload,
} from '@acme/shared';
import { z } from 'zod';
import type { Db, Prisma, PrismaClient } from '../../db.ts';
import type { Clock } from '../../lib/clock.ts';
import { fromIsoDate } from '../../lib/clock.ts';
import { AppError, BusinessRuleError, ConflictError, NotFoundError } from '../../http/errors.ts';
import type { Actor } from '../audit/audit.ts';
import { parseCsv } from './csv.ts';

const PREVIEW_TTL_MS = 30 * 60 * 1000;
const MAX_ISSUES_RETURNED = 500;
const SAMPLE_SIZE = 10;

/** One validated, normalised row stored in the batch until commit. */
interface ImportRow {
  row: number;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  countryCode: string;
  departmentId: number;
  departmentName: string;
  jobTitleId: number;
  jobTitleName: string;
  status: 'ACTIVE' | 'ON_LEAVE';
  hireDate: string;
  amount: string;
  currencyCode: string;
  effectiveFrom: string;
}

const cell = z.string().trim();
const rowSchema = z.object({
  employee_id: employeeCodeSchema,
  first_name: cell.min(1, 'Required').max(100),
  last_name: cell.min(1, 'Required').max(100),
  email: cell.toLowerCase().max(254).pipe(z.email('Must be a valid email address')),
  country: countryCodeSchema,
  department: cell.min(1, 'Required').max(100),
  job_title: cell.min(1, 'Required').max(100),
  // Optional columns may be absent (undefined) or blank ('').
  status: z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? v.trim().toUpperCase().replace(/\s+/g, '_') : 'ACTIVE'))
    .pipe(
      z.enum(ASSIGNABLE_STATUSES, {
        message: 'Must be ACTIVE or ON_LEAVE (inactive employees cannot be imported)',
      }),
    ),
  hire_date: isoDateSchema,
  salary: amountSchema,
  currency: currencyCodeSchema,
  salary_effective_from: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined)
    .pipe(isoDateSchema.optional()),
});

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const lower = (value: string) => value.trim().toLowerCase();

function toSample(row: ImportRow): ImportSampleRow {
  return {
    row: row.row,
    employeeCode: row.employeeCode,
    name: `${row.firstName} ${row.lastName}`,
    email: row.email,
    country: row.countryCode,
    department: row.departmentName,
    jobTitle: row.jobTitleName,
    hireDate: row.hireDate,
    salary: row.amount,
    currency: row.currencyCode,
  };
}

async function findExisting(db: Db, codes: string[], emails: string[]) {
  const existingCodes = new Set<string>();
  const existingEmails = new Set<string>();
  for (let i = 0; i < Math.max(codes.length, emails.length); i += 1_000) {
    const rows = await db.employee.findMany({
      where: {
        OR: [
          { employeeCode: { in: codes.slice(i, i + 1_000) } },
          { email: { in: emails.slice(i, i + 1_000) } },
        ],
      },
      select: { employeeCode: true, email: true },
    });
    for (const row of rows) {
      existingCodes.add(row.employeeCode);
      existingEmails.add(row.email);
    }
  }
  return { existingCodes, existingEmails };
}

export class ImportService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: Clock,
  ) {}

  async preview(actor: Actor, upload: ImportUpload): Promise<ImportPreview> {
    const { headers, rows } = parseCsv(upload.content);
    const missing = CSV_REQUIRED_IMPORT_COLUMNS.filter((column) => !headers.includes(column));
    if (missing.length) {
      throw new BusinessRuleError(`The file is missing required columns: ${missing.join(', ')}.`, [
        { path: 'content', message: `Expected columns: ${CSV_REQUIRED_IMPORT_COLUMNS.join(', ')}` },
      ]);
    }
    if (rows.length === 0)
      throw new BusinessRuleError('The file has a header row but no data rows.');
    if (rows.length > CSV_MAX_ROWS) {
      throw new AppError(
        413,
        'too-many-rows',
        'Too many rows',
        `Import at most ${CSV_MAX_ROWS.toLocaleString('en')} rows per file.`,
      );
    }

    const [countries, departments, jobTitles, currencies] = await Promise.all([
      this.prisma.country.findMany({ select: { code: true } }),
      this.prisma.department.findMany(),
      this.prisma.jobTitle.findMany(),
      this.prisma.currency.findMany(),
    ]);
    const countryCodes = new Set(countries.map((c) => c.code));
    const departmentByName = new Map(departments.map((d) => [lower(d.name), d]));
    const jobTitleByName = new Map(jobTitles.map((t) => [lower(t.name), t]));
    const minorUnits = new Map(currencies.map((c) => [c.code, c.minorUnits]));

    const issues: ImportRowIssue[] = [];
    const candidates: ImportRow[] = [];
    const firstRowByCode = new Map<string, number>();
    const firstRowByEmail = new Map<string, number>();

    rows.forEach((raw, index) => {
      const rowNumber = index + 2; // header is row 1
      const parsed = rowSchema.safeParse(raw);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          issues.push({
            row: rowNumber,
            column: String(issue.path[0] ?? ''),
            message: issue.message,
            kind: 'invalid',
          });
        }
        return;
      }
      const r = parsed.data;
      const rowIssues: ImportRowIssue[] = [];
      const invalid = (column: string, message: string) =>
        rowIssues.push({ row: rowNumber, column, message, kind: 'invalid' });

      if (!countryCodes.has(r.country)) invalid('country', `Unknown country code ${r.country}`);
      const department = departmentByName.get(lower(r.department));
      if (!department) invalid('department', `Unknown department "${r.department}"`);
      const jobTitle = jobTitleByName.get(lower(r.job_title));
      if (!jobTitle) invalid('job_title', `Unknown job title "${r.job_title}"`);
      const units = minorUnits.get(r.currency);
      if (units === undefined) invalid('currency', `Unsupported currency ${r.currency}`);
      else if (!fitsCurrencyScale(r.salary, units)) {
        invalid(
          'salary',
          units === 0
            ? `${r.currency} amounts must be whole numbers`
            : `${r.currency} allows at most ${units} decimal places`,
        );
      }
      const effectiveFrom = r.salary_effective_from ?? r.hire_date;
      if (effectiveFrom < r.hire_date)
        invalid('salary_effective_from', 'Must be on or after the hire date');

      if (rowIssues.length) {
        issues.push(...rowIssues);
        return;
      }

      const earlierCode = firstRowByCode.get(r.employee_id);
      const earlierEmail = firstRowByEmail.get(r.email);
      if (earlierCode || earlierEmail) {
        issues.push({
          row: rowNumber,
          column: earlierCode ? 'employee_id' : 'email',
          message: `Duplicate of row ${earlierCode ?? earlierEmail} in this file`,
          kind: 'duplicate',
        });
        return;
      }
      firstRowByCode.set(r.employee_id, rowNumber);
      firstRowByEmail.set(r.email, rowNumber);
      candidates.push({
        row: rowNumber,
        employeeCode: r.employee_id,
        firstName: r.first_name,
        lastName: r.last_name,
        email: r.email,
        countryCode: r.country,
        departmentId: department!.id,
        departmentName: department!.name,
        jobTitleId: jobTitle!.id,
        jobTitleName: jobTitle!.name,
        status: r.status,
        hireDate: r.hire_date,
        amount: r.salary,
        currencyCode: r.currency,
        effectiveFrom,
      });
    });

    const { existingCodes, existingEmails } = await findExisting(
      this.prisma,
      candidates.map((c) => c.employeeCode),
      candidates.map((c) => c.email),
    );
    const valid = candidates.filter((c) => {
      const clash = existingCodes.has(c.employeeCode)
        ? 'employee_id'
        : existingEmails.has(c.email)
          ? 'email'
          : null;
      if (clash) {
        issues.push({
          row: c.row,
          column: clash,
          message:
            clash === 'employee_id'
              ? `Employee ${c.employeeCode} already exists`
              : `An employee with ${c.email} already exists`,
          kind: 'duplicate',
        });
      }
      return !clash;
    });
    issues.sort((a, b) => a.row - b.row);

    const hash = sha256(upload.content);
    const now = this.clock.now();
    const [batch, previous] = await Promise.all([
      this.prisma.importBatch.create({
        data: {
          uploadedById: actor.userId,
          fileName: upload.fileName,
          fileSha256: hash,
          totalRows: rows.length,
          validRows: valid.length,
          invalidRows: new Set(issues.filter((i) => i.kind === 'invalid').map((i) => i.row)).size,
          duplicateRows: issues.filter((i) => i.kind === 'duplicate').length,
          validPayload: valid as unknown as Prisma.InputJsonValue,
          rowErrors: issues as unknown as Prisma.InputJsonValue,
          createdAt: now,
          expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS),
        },
      }),
      this.prisma.importBatch.findFirst({
        where: { fileSha256: hash, status: 'COMMITTED' },
        orderBy: { committedAt: 'desc' },
        select: { committedAt: true },
      }),
    ]);
    return this.toPreview(batch, previous?.committedAt ?? null);
  }

  async get(id: string): Promise<ImportPreview> {
    const batch = await this.prisma.importBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundError('Import');
    return this.toPreview(batch, null);
  }

  /**
   * Imports every valid row atomically. The PREVIEWED -> COMMITTED transition is a guarded UPDATE,
   * so double clicks, retries and two managers committing at once import the file exactly once.
   */
  async commit(actor: Actor, id: string): Promise<ImportPreview & { importedRows: number }> {
    const now = this.clock.now();
    const result = await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.importBatch.updateMany({
          where: { id, status: 'PREVIEWED', expiresAt: { gt: now } },
          data: { status: 'COMMITTED', committedAt: now },
        });
        if (claimed.count === 0) {
          const batch = await tx.importBatch.findUnique({
            where: { id },
            select: { status: true },
          });
          if (!batch) throw new NotFoundError('Import');
          if (batch.status === 'COMMITTED') {
            throw new ConflictError(
              'This file has already been imported.',
              undefined,
              'import-already-committed',
            );
          }
          throw new ConflictError(
            'This preview has expired. Upload the file again to re-check it.',
            undefined,
            'import-expired',
          );
        }

        const batch = await tx.importBatch.findUniqueOrThrow({ where: { id } });
        const rows = batch.validPayload as unknown as ImportRow[];
        if (rows.length === 0) throw new BusinessRuleError('There are no valid rows to import.');

        // Another user may have created matching employees since the preview.
        const { existingCodes, existingEmails } = await findExisting(
          tx,
          rows.map((r) => r.employeeCode),
          rows.map((r) => r.email),
        );
        const clashes = rows.filter(
          (r) => existingCodes.has(r.employeeCode) || existingEmails.has(r.email),
        ).length;
        if (clashes) {
          throw new ConflictError(
            `${clashes} row(s) now match employees created after the preview. Nothing was imported; upload the file again.`,
            undefined,
            'import-stale',
          );
        }

        const withIds = rows.map((r) => ({
          ...r,
          employeeId: randomUUID(),
          compensationId: randomUUID(),
        }));
        await tx.employee.createMany({
          data: withIds.map((r) => ({
            id: r.employeeId,
            employeeCode: r.employeeCode,
            firstName: r.firstName,
            lastName: r.lastName,
            email: r.email,
            countryCode: r.countryCode,
            departmentId: r.departmentId,
            jobTitleId: r.jobTitleId,
            status: r.status,
            hireDate: fromIsoDate(r.hireDate),
          })),
        });
        await tx.compensation.createMany({
          data: withIds.map((r) => ({
            id: r.compensationId,
            employeeId: r.employeeId,
            amount: r.amount,
            currencyCode: r.currencyCode,
            effectiveFrom: fromIsoDate(r.effectiveFrom),
            reason: 'NEW_HIRE' as const,
            note: `Imported from ${batch.fileName}`,
            createdById: actor.userId,
          })),
        });
        const source = { source: 'csv-import', importId: id };
        await tx.auditLog.createMany({
          data: [
            ...withIds.flatMap((r) => [
              {
                actorUserId: actor.userId,
                requestId: actor.requestId,
                action: 'EMPLOYEE_CREATED',
                entityType: 'EMPLOYEE',
                entityId: r.employeeId,
                employeeId: r.employeeId,
                changes: {
                  after: {
                    employeeCode: r.employeeCode,
                    firstName: r.firstName,
                    lastName: r.lastName,
                    email: r.email,
                    countryCode: r.countryCode,
                    departmentId: r.departmentId,
                    jobTitleId: r.jobTitleId,
                    status: r.status,
                    hireDate: r.hireDate,
                  },
                  ...source,
                },
              },
              {
                actorUserId: actor.userId,
                requestId: actor.requestId,
                action: 'COMPENSATION_CREATED',
                entityType: 'COMPENSATION',
                entityId: r.compensationId,
                employeeId: r.employeeId,
                changes: {
                  after: {
                    amount: r.amount,
                    currencyCode: r.currencyCode,
                    effectiveFrom: r.effectiveFrom,
                    effectiveTo: null,
                    reason: 'NEW_HIRE',
                  },
                  ...source,
                },
              },
            ]),
            {
              actorUserId: actor.userId,
              requestId: actor.requestId,
              action: 'IMPORT_COMMITTED',
              entityType: 'IMPORT',
              entityId: id,
              employeeId: null,
              changes: {
                fileName: batch.fileName,
                importedRows: rows.length,
                skippedRows: batch.totalRows - rows.length,
              },
            },
          ],
        });
        return { batch, importedRows: rows.length };
      },
      { timeout: 120_000 },
    );
    return { ...this.toPreview(result.batch, null), importedRows: result.importedRows };
  }

  private toPreview(
    batch: Awaited<ReturnType<PrismaClient['importBatch']['findUniqueOrThrow']>>,
    previouslyImportedAt: Date | null,
  ): ImportPreview {
    const issues = batch.rowErrors as unknown as ImportRowIssue[];
    const rows = batch.validPayload as unknown as ImportRow[];
    return {
      id: batch.id,
      fileName: batch.fileName,
      status: batch.status,
      totalRows: batch.totalRows,
      validRows: batch.validRows,
      invalidRows: batch.invalidRows,
      duplicateRows: batch.duplicateRows,
      issues: issues.slice(0, MAX_ISSUES_RETURNED),
      issuesTruncated: Math.max(0, issues.length - MAX_ISSUES_RETURNED),
      sample: rows.slice(0, SAMPLE_SIZE).map(toSample),
      createdAt: batch.createdAt.toISOString(),
      expiresAt: batch.expiresAt.toISOString(),
      committedAt: batch.committedAt?.toISOString() ?? null,
      previouslyImportedAt: previouslyImportedAt?.toISOString() ?? null,
    };
  }
}
