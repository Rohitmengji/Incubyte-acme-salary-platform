export const EMPLOYEE_STATUSES = ['ACTIVE', 'ON_LEAVE', 'INACTIVE'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

/** Statuses that can be set directly; INACTIVE is only reachable through deactivation. */
export const ASSIGNABLE_STATUSES = ['ACTIVE', 'ON_LEAVE'] as const;
export type AssignableStatus = (typeof ASSIGNABLE_STATUSES)[number];

export const COMPENSATION_REASONS = [
  'NEW_HIRE',
  'ANNUAL_REVIEW',
  'PROMOTION',
  'MARKET_ADJUSTMENT',
  'ROLE_CHANGE',
  'CORRECTION',
  'OTHER',
] as const;
export type CompensationReason = (typeof COMPENSATION_REASONS)[number];

export const USER_ROLES = ['HR_MANAGER', 'HR_VIEWER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const EMPLOYEE_SORT_FIELDS = [
  'name',
  'employeeCode',
  'hireDate',
  'country',
  'department',
  'jobTitle',
  'status',
] as const;
export type EmployeeSortField = (typeof EMPLOYEE_SORT_FIELDS)[number];

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const MAX_PAGE_SIZE = 100;
