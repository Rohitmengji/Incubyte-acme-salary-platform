import type { Money } from './money.ts';
import type {
  AnalyticsDimension,
  CompensationReason,
  CurrencyMode,
  EmployeeStatus,
  UserRole,
} from './enums.ts';

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

// ---------- Analytics ----------

/** Amounts are decimal strings rounded to the currency's minor units; `n` is the population size. */
export interface PayStats {
  currency: string;
  n: number;
  min: string;
  max: string;
  avg: string;
  median: string;
  p25: string;
  p75: string;
  total: string;
  /** Fewer than 5 people: the median/average are not representative. */
  smallSample: boolean;
}

export interface FxSnapshot {
  asOfDate: string;
  source: string;
  reportingCurrency: string;
}

export interface AnalyticsSummary {
  asOf: string;
  records: { total: number; byStatus: Record<EmployeeStatus, number> };
  /** People employed on `asOf` (hired on or before it and not yet terminated). */
  employedHeadcount: number;
  headcountByCountry: { code: string; name: string; count: number }[];
  /** Salary statistics per pay currency - never summed across currencies. */
  payByCurrency: PayStats[];
  /** Company-wide statistics converted to the reporting currency, or null without an FX snapshot. */
  normalized: PayStats | null;
  fx: FxSnapshot | null;
  /** People excluded from normalised figures because their currency has no rate in the snapshot. */
  missingFxRates: number;
}

export interface DistributionRow extends PayStats {
  key: string;
  label: string;
}

export interface DistributionResponse {
  asOf: string;
  dimension: AnalyticsDimension;
  currencyMode: CurrencyMode;
  fx: FxSnapshot | null;
  rows: DistributionRow[];
}

export interface HistogramResponse {
  asOf: string;
  currency: string;
  normalized: boolean;
  fx: FxSnapshot | null;
  buckets: { from: string; to: string | null; count: number }[];
}

export interface TrendsResponse {
  asOf: string;
  currency: string;
  fx: FxSnapshot | null;
  /** One point per month end (the current month uses `asOf`); population = employed on that date. */
  points: { date: string; n: number; median: string; avg: string }[];
}

export interface RecentSalaryChange {
  id: string;
  occurredAt: string;
  action: 'COMPENSATION_CREATED' | 'COMPENSATION_CORRECTED';
  employee: { id: string; employeeCode: string; firstName: string; lastName: string };
  actor: { id: string; displayName: string } | null;
  before: Record<string, string | null> | null;
  after: Record<string, string | null>;
  /** Currency of the amounts when the change itself did not touch the currency. */
  currencyCode: string | null;
  correctionReason: string | null;
}

// ---------- CSV import ----------

export interface ImportRowIssue {
  /** Spreadsheet row number (the header is row 1). */
  row: number;
  column: string | null;
  message: string;
  kind: 'invalid' | 'duplicate';
}

export interface ImportSampleRow {
  row: number;
  employeeCode: string;
  name: string;
  email: string;
  country: string;
  department: string;
  jobTitle: string;
  hireDate: string;
  salary: string;
  currency: string;
}

export interface ImportPreview {
  id: string;
  fileName: string;
  status: 'PREVIEWED' | 'COMMITTED';
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  /** Row-level problems (capped; see issuesTruncated). */
  issues: ImportRowIssue[];
  issuesTruncated: number;
  /** First valid rows, so the user can check the mapping before committing. */
  sample: ImportSampleRow[];
  createdAt: string;
  expiresAt: string;
  committedAt: string | null;
  /** Set when an identical file was already imported. */
  previouslyImportedAt: string | null;
}
