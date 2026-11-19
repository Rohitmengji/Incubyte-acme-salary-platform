import type {
  CompensationRecord,
  CorrectCompensationRequest,
  CreateCompensationRequest,
} from '@acme/shared';
import type { Db, Prisma, PrismaClient } from '../../db.ts';
import { fromIsoDate, toIsoDate, type Clock } from '../../lib/clock.ts';
import { NotFoundError, StaleVersionError } from '../../http/errors.ts';
import {
  planInsertion,
  planStartDateMove,
  type Period,
  type PeriodEndChange,
} from '../../domain/timeline.ts';
import { diff, writeAudit, type Actor } from '../audit/audit.ts';
import { assertAmountForCurrency, lockEmployee, mapTimelineError } from '../guards.ts';

const recordSelect = {
  id: true,
  employeeId: true,
  amount: true,
  currencyCode: true,
  effectiveFrom: true,
  effectiveTo: true,
  reason: true,
  note: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  currency: { select: { minorUnits: true } },
  createdBy: { select: { id: true, displayName: true } },
} satisfies Prisma.CompensationSelect;

type RecordRow = Prisma.CompensationGetPayload<{ select: typeof recordSelect }>;

function toPeriod(row: { id: string; effectiveFrom: Date; effectiveTo: Date | null }): Period {
  return {
    id: row.id,
    effectiveFrom: toIsoDate(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? toIsoDate(row.effectiveTo) : null,
  };
}

function snapshot(row: RecordRow) {
  return {
    amount: row.amount.toFixed(row.currency.minorUnits),
    currencyCode: row.currencyCode,
    effectiveFrom: toIsoDate(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? toIsoDate(row.effectiveTo) : null,
    reason: row.reason as string,
    note: row.note,
  };
}

export class CompensationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: Clock,
  ) {}

  private toRecord(row: RecordRow): CompensationRecord {
    const today = this.clock.today();
    const period = toPeriod(row);
    return {
      id: row.id,
      employeeId: row.employeeId,
      amount: row.amount.toFixed(row.currency.minorUnits),
      currency: row.currencyCode,
      effectiveFrom: period.effectiveFrom,
      effectiveTo: period.effectiveTo,
      reason: row.reason,
      note: row.note,
      isCurrent:
        period.effectiveFrom <= today &&
        (period.effectiveTo === null || period.effectiveTo > today),
      version: row.version,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Full salary history, newest first. */
  async history(employeeId: string): Promise<CompensationRecord[]> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundError('Employee');
    const rows = await this.prisma.compensation.findMany({
      where: { employeeId },
      orderBy: { effectiveFrom: 'desc' },
      select: recordSelect,
    });
    return rows.map((row) => this.toRecord(row));
  }

  /** Adds a salary change anywhere in the timeline (ADR-0003). */
  async create(
    actor: Actor,
    employeeId: string,
    input: CreateCompensationRequest,
  ): Promise<CompensationRecord> {
    return this.prisma.$transaction(async (tx) => {
      await lockEmployee(tx, employeeId);
      const employee = await tx.employee.findUniqueOrThrow({
        where: { id: employeeId },
        select: { hireDate: true, status: true },
      });
      await assertAmountForCurrency(tx, input.amount, input.currencyCode);
      const periods = await tx.compensation.findMany({
        where: { employeeId },
        select: recordSelect,
      });

      let plan: ReturnType<typeof planInsertion>;
      try {
        plan = planInsertion(
          periods.map(toPeriod),
          { hireDate: toIsoDate(employee.hireDate), status: employee.status },
          input.effectiveFrom,
        );
      } catch (error) {
        mapTimelineError(error);
      }

      const cause = `Salary change effective ${input.effectiveFrom} added`;
      await this.applyEndChanges(tx, actor, employeeId, periods, plan.endChanges, cause);
      const created = await tx.compensation.create({
        data: {
          employeeId,
          amount: input.amount,
          currencyCode: input.currencyCode,
          effectiveFrom: fromIsoDate(plan.newPeriod.effectiveFrom),
          effectiveTo: plan.newPeriod.effectiveTo ? fromIsoDate(plan.newPeriod.effectiveTo) : null,
          reason: input.reason,
          note: input.note ?? null,
          createdById: actor.userId,
        },
        select: recordSelect,
      });
      await writeAudit(tx, actor, {
        action: 'COMPENSATION_CREATED',
        entityType: 'COMPENSATION',
        entityId: created.id,
        employeeId,
        changes: { after: snapshot(created) },
      });
      return this.toRecord(created);
    });
  }

  /** Corrects a salary record; history is edited, never deleted, and every change is audited. */
  async correct(
    actor: Actor,
    employeeId: string,
    compensationId: string,
    input: CorrectCompensationRequest,
  ): Promise<CompensationRecord> {
    return this.prisma
      .$transaction(async (tx) => {
        await lockEmployee(tx, employeeId);
        const periods = await tx.compensation.findMany({
          where: { employeeId },
          select: recordSelect,
        });
        const current = periods.find((p) => p.id === compensationId);
        if (!current) throw new NotFoundError('Salary record');
        if (current.version !== input.version) throw new StaleVersionError('This salary record');

        const before = snapshot(current);
        const amount = input.amount ?? current.amount.toString();
        const currencyCode = input.currencyCode ?? current.currencyCode;
        if (input.amount !== undefined || input.currencyCode !== undefined) {
          await assertAmountForCurrency(tx, amount, currencyCode);
        }

        let endChanges: PeriodEndChange[] = [];
        if (input.effectiveFrom !== undefined) {
          const employee = await tx.employee.findUniqueOrThrow({
            where: { id: employeeId },
            select: { hireDate: true, status: true },
          });
          try {
            endChanges = planStartDateMove(
              periods.map(toPeriod),
              { hireDate: toIsoDate(employee.hireDate), status: employee.status },
              compensationId,
              input.effectiveFrom,
            ).endChanges;
          } catch (error) {
            mapTimelineError(error);
          }
        }

        const updated = await tx.compensation.update({
          where: { id: compensationId },
          data: {
            amount,
            currencyCode,
            ...(input.effectiveFrom !== undefined && {
              effectiveFrom: fromIsoDate(input.effectiveFrom),
            }),
            ...(input.reason !== undefined && { reason: input.reason }),
            ...(input.note !== undefined && { note: input.note }),
            version: { increment: 1 },
          },
          select: recordSelect,
        });
        const changes = diff(before, snapshot(updated));
        if (!changes) {
          // Nothing actually changed: roll back the version bump rather than auditing a no-op.
          throw new NoChange();
        }
        await this.applyEndChanges(
          tx,
          actor,
          employeeId,
          periods,
          endChanges,
          `Start date of ${compensationId} corrected`,
        );
        await writeAudit(tx, actor, {
          action: 'COMPENSATION_CORRECTED',
          entityType: 'COMPENSATION',
          entityId: compensationId,
          employeeId,
          changes: { ...changes, correctionReason: input.correctionReason },
        });
        return this.toRecord(updated);
      })
      .catch(async (error: unknown) => {
        if (error instanceof NoChange) {
          const row = await this.prisma.compensation.findUniqueOrThrow({
            where: { id: compensationId },
            select: recordSelect,
          });
          return this.toRecord(row);
        }
        throw error;
      });
  }

  /** Moves neighbouring periods' end dates and audits each adjustment. */
  private async applyEndChanges(
    tx: Db,
    actor: Actor,
    employeeId: string,
    periods: RecordRow[],
    changes: PeriodEndChange[],
    cause: string,
  ): Promise<void> {
    for (const change of changes) {
      const previous = periods.find((p) => p.id === change.id);
      await tx.compensation.update({
        where: { id: change.id },
        data: {
          effectiveTo: change.effectiveTo ? fromIsoDate(change.effectiveTo) : null,
          version: { increment: 1 },
        },
      });
      await writeAudit(tx, actor, {
        action: 'COMPENSATION_PERIOD_ADJUSTED',
        entityType: 'COMPENSATION',
        entityId: change.id,
        employeeId,
        changes: {
          before: { effectiveTo: previous?.effectiveTo ? toIsoDate(previous.effectiveTo) : null },
          after: { effectiveTo: change.effectiveTo },
          cause,
        },
      });
    }
  }
}

class NoChange extends Error {}
