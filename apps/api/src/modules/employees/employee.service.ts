import type {
  AuditEvent,
  CreateEmployeeRequest,
  DeactivateEmployeeRequest,
  EmployeeDetail,
  EmployeeListQuery,
  EmployeeSummary,
  Paginated,
  ReactivateEmployeeRequest,
  UpdateEmployeeRequest,
} from '@acme/shared';
import type { Db, Prisma, PrismaClient } from '../../db.ts';
import { fromIsoDate, toIsoDate, type Clock } from '../../lib/clock.ts';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  StaleVersionError,
} from '../../http/errors.ts';
import { diff, writeAudit, type Actor } from '../audit/audit.ts';
import { assertAmountForCurrency, assertReferencesExist, lockEmployee } from '../guards.ts';

function currentPeriodFilter(today: Date) {
  return {
    effectiveFrom: { lte: today },
    OR: [{ effectiveTo: null }, { effectiveTo: { gt: today } }],
  } satisfies Prisma.CompensationWhereInput;
}

export function employeeSelect(today: Date) {
  return {
    id: true,
    employeeCode: true,
    firstName: true,
    lastName: true,
    email: true,
    status: true,
    hireDate: true,
    terminationDate: true,
    version: true,
    createdAt: true,
    updatedAt: true,
    country: { select: { code: true, name: true } },
    department: { select: { id: true, name: true } },
    jobTitle: { select: { id: true, name: true } },
    // Prisma loads this for the whole page in one batched query, not one query per employee.
    compensations: {
      where: currentPeriodFilter(today),
      take: 1,
      select: {
        amount: true,
        effectiveFrom: true,
        currency: { select: { code: true, minorUnits: true } },
      },
    },
  } satisfies Prisma.EmployeeSelect;
}

type EmployeeRow = Prisma.EmployeeGetPayload<{ select: ReturnType<typeof employeeSelect> }>;

export function toSummary(row: EmployeeRow): EmployeeSummary {
  const current = row.compensations[0];
  return {
    id: row.id,
    employeeCode: row.employeeCode,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    status: row.status,
    hireDate: toIsoDate(row.hireDate),
    terminationDate: row.terminationDate ? toIsoDate(row.terminationDate) : null,
    country: row.country,
    department: row.department,
    jobTitle: row.jobTitle,
    currentCompensation: current
      ? {
          amount: current.amount.toFixed(current.currency.minorUnits),
          currency: current.currency.code,
          effectiveFrom: toIsoDate(current.effectiveFrom),
        }
      : null,
  };
}

function toDetail(row: EmployeeRow): EmployeeDetail {
  return {
    ...toSummary(row),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Escapes LIKE wildcards so a search for "50%" or "A_B" matches literally. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function listWhere(
  query: Omit<EmployeeListQuery, 'page' | 'pageSize'>,
): Prisma.EmployeeWhereInput {
  const tokens = (query.search ?? '').split(/\s+/).filter(Boolean).slice(0, 5);
  return {
    // Every token must match a first name, last name or employee ID ("priya sha" finds Priya Sharma).
    AND: tokens.map((token) => {
      const contains = { contains: escapeLike(token), mode: 'insensitive' as const };
      return { OR: [{ firstName: contains }, { lastName: contains }, { employeeCode: contains }] };
    }),
    ...(query.country && { countryCode: { in: query.country } }),
    ...(query.department && { departmentId: { in: query.department } }),
    ...(query.jobTitle && { jobTitleId: { in: query.jobTitle } }),
    ...(query.status && { status: { in: query.status } }),
  };
}

export function listOrderBy(
  query: Pick<EmployeeListQuery, 'sort' | 'order'>,
): Prisma.EmployeeOrderByWithRelationInput[] {
  const dir = query.order;
  // Every ordering ends with a unique column so pages never overlap or skip rows.
  const byName: Prisma.EmployeeOrderByWithRelationInput[] = [
    { lastName: 'asc' },
    { firstName: 'asc' },
    { id: 'asc' },
  ];
  switch (query.sort) {
    case 'name':
      return [{ lastName: dir }, { firstName: dir }, { id: dir }];
    case 'employeeCode':
      return [{ employeeCode: dir }];
    case 'hireDate':
      return [{ hireDate: dir }, { id: dir }];
    case 'country':
      return [{ country: { name: dir } }, ...byName];
    case 'department':
      return [{ department: { name: dir } }, ...byName];
    case 'jobTitle':
      return [{ jobTitle: { name: dir } }, ...byName];
    case 'status':
      return [{ status: dir }, ...byName];
  }
}

const snapshotSelect = {
  firstName: true,
  lastName: true,
  email: true,
  countryCode: true,
  departmentId: true,
  jobTitleId: true,
  status: true,
  hireDate: true,
  terminationDate: true,
  version: true,
} satisfies Prisma.EmployeeSelect;

type Snapshot = Prisma.EmployeeGetPayload<{ select: typeof snapshotSelect }>;

function flatten(s: Snapshot) {
  return {
    firstName: s.firstName,
    lastName: s.lastName,
    email: s.email,
    countryCode: s.countryCode,
    departmentId: s.departmentId,
    jobTitleId: s.jobTitleId,
    status: s.status as string,
    hireDate: toIsoDate(s.hireDate),
    terminationDate: s.terminationDate ? toIsoDate(s.terminationDate) : null,
  };
}

export class EmployeeService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: Clock,
  ) {}

  async list(query: EmployeeListQuery): Promise<Paginated<EmployeeSummary>> {
    const where = listWhere(query);
    const [total, rows] = await Promise.all([
      this.prisma.employee.count({ where }),
      this.prisma.employee.findMany({
        where,
        orderBy: listOrderBy(query),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: employeeSelect(fromIsoDate(this.clock.today())),
      }),
    ]);
    return {
      data: rows.map(toSummary),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async get(id: string, db: Db = this.prisma): Promise<EmployeeDetail> {
    const row = await db.employee.findUnique({
      where: { id },
      select: employeeSelect(fromIsoDate(this.clock.today())),
    });
    if (!row) throw new NotFoundError('Employee');
    return toDetail(row);
  }

  async create(actor: Actor, input: CreateEmployeeRequest): Promise<EmployeeDetail> {
    const comp = input.initialCompensation;
    const effectiveFrom = comp.effectiveFrom ?? input.hireDate;
    if (effectiveFrom < input.hireDate) {
      throw new BusinessRuleError('The first salary cannot start before the hire date.', [
        { path: 'initialCompensation.effectiveFrom', message: 'Must be on or after the hire date' },
      ]);
    }

    return this.prisma.$transaction(async (tx) => {
      await assertReferencesExist(tx, input);
      await assertAmountForCurrency(tx, comp.amount, comp.currencyCode, 'initialCompensation.');

      const employee = await tx.employee.create({
        data: {
          employeeCode: input.employeeCode,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          countryCode: input.countryCode,
          departmentId: input.departmentId,
          jobTitleId: input.jobTitleId,
          status: input.status,
          hireDate: fromIsoDate(input.hireDate),
        },
        select: { id: true, ...snapshotSelect },
      });
      const compensation = await tx.compensation.create({
        data: {
          employeeId: employee.id,
          amount: comp.amount,
          currencyCode: comp.currencyCode,
          effectiveFrom: fromIsoDate(effectiveFrom),
          reason: comp.reason,
          note: comp.note ?? null,
          createdById: actor.userId,
        },
      });

      await writeAudit(tx, actor, {
        action: 'EMPLOYEE_CREATED',
        entityType: 'EMPLOYEE',
        entityId: employee.id,
        employeeId: employee.id,
        changes: { after: { employeeCode: input.employeeCode, ...flatten(employee) } },
      });
      await writeAudit(tx, actor, {
        action: 'COMPENSATION_CREATED',
        entityType: 'COMPENSATION',
        entityId: compensation.id,
        employeeId: employee.id,
        changes: {
          after: {
            amount: comp.amount,
            currencyCode: comp.currencyCode,
            effectiveFrom,
            effectiveTo: null,
            reason: comp.reason,
            note: comp.note ?? null,
          },
        },
      });
      return this.get(employee.id, tx);
    });
  }

  async update(actor: Actor, id: string, input: UpdateEmployeeRequest): Promise<EmployeeDetail> {
    return this.prisma.$transaction(async (tx) => {
      await lockEmployee(tx, id);
      const current = await tx.employee.findUniqueOrThrow({
        where: { id },
        select: snapshotSelect,
      });
      if (current.version !== input.version) throw new StaleVersionError('This employee');
      if (current.status === 'INACTIVE' && input.status) {
        throw new BusinessRuleError('Reactivate this employee before changing their status.', [
          { path: 'status', message: 'Employee is inactive' },
        ]);
      }
      await assertReferencesExist(tx, input);

      if (input.hireDate) {
        const first = await tx.compensation.findFirst({
          where: { employeeId: id },
          orderBy: { effectiveFrom: 'asc' },
          select: { effectiveFrom: true },
        });
        if (first && input.hireDate > toIsoDate(first.effectiveFrom)) {
          throw new BusinessRuleError('The hire date cannot be after the first salary period.', [
            { path: 'hireDate', message: `Must be on or before ${toIsoDate(first.effectiveFrom)}` },
          ]);
        }
        if (current.terminationDate && input.hireDate > toIsoDate(current.terminationDate)) {
          throw new BusinessRuleError('The hire date cannot be after the termination date.', [
            {
              path: 'hireDate',
              message: `Must be on or before ${toIsoDate(current.terminationDate)}`,
            },
          ]);
        }
      }

      const before = flatten(current);
      const { version: _version, ...requested } = input;
      const after: typeof before = { ...before };
      for (const [key, value] of Object.entries(requested) as [
        keyof typeof before,
        string | number,
      ][]) {
        if (value !== undefined) (after as Record<string, unknown>)[key] = value;
      }
      const changes = diff(before, after);
      if (!changes) return this.get(id, tx);

      await tx.employee.update({
        where: { id },
        data: {
          firstName: after.firstName,
          lastName: after.lastName,
          email: after.email,
          countryCode: after.countryCode,
          departmentId: after.departmentId,
          jobTitleId: after.jobTitleId,
          status: after.status as 'ACTIVE' | 'ON_LEAVE',
          hireDate: fromIsoDate(after.hireDate),
          version: { increment: 1 },
        },
      });
      await writeAudit(tx, actor, {
        action: 'EMPLOYEE_UPDATED',
        entityType: 'EMPLOYEE',
        entityId: id,
        employeeId: id,
        changes,
      });
      return this.get(id, tx);
    });
  }

  async deactivate(
    actor: Actor,
    id: string,
    input: DeactivateEmployeeRequest,
  ): Promise<EmployeeDetail> {
    return this.prisma.$transaction(async (tx) => {
      await lockEmployee(tx, id);
      const current = await tx.employee.findUniqueOrThrow({
        where: { id },
        select: snapshotSelect,
      });
      if (current.version !== input.version) throw new StaleVersionError('This employee');
      if (current.status === 'INACTIVE')
        throw new ConflictError('This employee is already inactive.');
      if (input.terminationDate < toIsoDate(current.hireDate)) {
        throw new BusinessRuleError('The termination date cannot be before the hire date.', [
          {
            path: 'terminationDate',
            message: `Must be on or after ${toIsoDate(current.hireDate)}`,
          },
        ]);
      }
      await tx.employee.update({
        where: { id },
        data: {
          status: 'INACTIVE',
          terminationDate: fromIsoDate(input.terminationDate),
          version: { increment: 1 },
        },
      });
      await writeAudit(tx, actor, {
        action: 'EMPLOYEE_DEACTIVATED',
        entityType: 'EMPLOYEE',
        entityId: id,
        employeeId: id,
        changes: {
          before: { status: current.status, terminationDate: null },
          after: { status: 'INACTIVE', terminationDate: input.terminationDate },
          reason: input.reason,
        },
      });
      return this.get(id, tx);
    });
  }

  /** Undoes a mistaken deactivation. Rehiring is out of scope (requirements.md). */
  async reactivate(
    actor: Actor,
    id: string,
    input: ReactivateEmployeeRequest,
  ): Promise<EmployeeDetail> {
    return this.prisma.$transaction(async (tx) => {
      await lockEmployee(tx, id);
      const current = await tx.employee.findUniqueOrThrow({
        where: { id },
        select: snapshotSelect,
      });
      if (current.version !== input.version) throw new StaleVersionError('This employee');
      if (current.status !== 'INACTIVE') throw new ConflictError('This employee is not inactive.');
      await tx.employee.update({
        where: { id },
        data: { status: 'ACTIVE', terminationDate: null, version: { increment: 1 } },
      });
      await writeAudit(tx, actor, {
        action: 'EMPLOYEE_REACTIVATED',
        entityType: 'EMPLOYEE',
        entityId: id,
        employeeId: id,
        changes: {
          before: {
            status: 'INACTIVE',
            terminationDate: current.terminationDate ? toIsoDate(current.terminationDate) : null,
          },
          after: { status: 'ACTIVE', terminationDate: null },
          reason: input.reason,
        },
      });
      return this.get(id, tx);
    });
  }

  async auditEvents(id: string, page: number, pageSize: number): Promise<Paginated<AuditEvent>> {
    const exists = await this.prisma.employee.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundError('Employee');
    const where = { employeeId: id };
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { actor: { select: { id: true, displayName: true } } },
      }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id.toString(),
        occurredAt: row.occurredAt.toISOString(),
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        actor: row.actor,
        changes: row.changes,
      })),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}
