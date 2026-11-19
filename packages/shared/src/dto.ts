import type { Money } from './money.ts';
import type { CompensationReason, EmployeeStatus, UserRole } from './enums.ts';

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** RFC 9457 problem details, returned with Content-Type application/problem+json. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  requestId?: string;
  errors?: { path: string; message: string }[];
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}

export interface CodeName<TCode = string> {
  code: TCode;
  name: string;
}

export interface IdName {
  id: number;
  name: string;
}

export interface ReferenceData {
  countries: { code: string; name: string; defaultCurrencyCode: string }[];
  currencies: { code: string; name: string; minorUnits: number }[];
  departments: IdName[];
  jobTitles: IdName[];
  statuses: readonly EmployeeStatus[];
  compensationReasons: readonly CompensationReason[];
}

export interface CurrentCompensation extends Money {
  effectiveFrom: string;
}

export interface EmployeeSummary {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  status: EmployeeStatus;
  hireDate: string;
  terminationDate: string | null;
  country: CodeName;
  department: IdName;
  jobTitle: IdName;
  /** Salary period covering today (UTC); null when none is in effect yet. */
  currentCompensation: CurrentCompensation | null;
}

export interface EmployeeDetail extends EmployeeSummary {
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CompensationRecord {
  id: string;
  employeeId: string;
  amount: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: CompensationReason;
  note: string | null;
  isCurrent: boolean;
  version: number;
  createdBy: { id: string; displayName: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  occurredAt: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: { id: string; displayName: string } | null;
  changes: unknown;
}
