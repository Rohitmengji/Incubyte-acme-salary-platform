import type { Db, Prisma } from '../../db.ts';

export type AuditAction =
  | 'EMPLOYEE_CREATED'
  | 'EMPLOYEE_UPDATED'
  | 'EMPLOYEE_DEACTIVATED'
  | 'EMPLOYEE_REACTIVATED'
  | 'COMPENSATION_CREATED'
  | 'COMPENSATION_CORRECTED'
  /** A neighbouring period's end date moved automatically because of another change. */
  | 'COMPENSATION_PERIOD_ADJUSTED';

export interface Actor {
  userId: string;
  requestId: string;
}

export interface AuditEntry {
  action: AuditAction;
  entityType: 'EMPLOYEE' | 'COMPENSATION';
  entityId: string;
  employeeId: string;
  changes: Prisma.InputJsonObject;
}

/**
 * Must be called with the transaction client of the change being audited, so the audit row commits
 * or rolls back together with it. The table itself is append-only (database trigger).
 */
export async function writeAudit(tx: Db, actor: Actor, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorUserId: actor.userId,
      requestId: actor.requestId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      employeeId: entry.employeeId,
      changes: entry.changes,
    },
  });
}

/** Returns only the keys whose values differ, as { before, after } JSON objects. */
export function diff<T extends Record<string, string | number | null>>(
  before: T,
  after: T,
): { before: Partial<T>; after: Partial<T> } | null {
  const changedKeys = (Object.keys(after) as (keyof T)[]).filter(
    (key) => before[key] !== after[key],
  );
  if (changedKeys.length === 0) return null;
  const pick = (source: T) =>
    Object.fromEntries(changedKeys.map((key) => [key, source[key]])) as Partial<T>;
  return { before: pick(before), after: pick(after) };
}
