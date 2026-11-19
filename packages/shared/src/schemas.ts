import { z } from 'zod';
import { isoDateSchema } from './dates.ts';
import { amountSchema, currencyCodeSchema } from './money.ts';
import {
  ASSIGNABLE_STATUSES,
  COMPENSATION_REASONS,
  EMPLOYEE_SORT_FIELDS,
  EMPLOYEE_STATUSES,
  MAX_PAGE_SIZE,
} from './enums.ts';

const name = z.string().trim().min(1, 'Required').max(100, 'Must be at most 100 characters');
const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email('Must be a valid email address'));
const id = z.coerce.number().int().positive();
const version = z.number().int().positive();
const reasonText = z.string().trim().min(3, 'Please give a short reason').max(500);

export const employeeCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(
    z
      .string()
      .regex(
        /^[A-Z0-9][A-Z0-9-]{2,19}$/,
        'Must be 3-20 characters: letters, digits and hyphens (e.g. EMP-000123)',
      ),
  );

export const countryCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}$/, 'Must be a 2-letter ISO country code'));

// ---------- Auth ----------

export const loginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Required').max(254),
  password: z.string().min(1, 'Required').max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

// ---------- Employees ----------

/** Accepts repeated query keys (?country=US&country=IN) or comma-separated values (?country=US,IN). */
function listParam<T extends z.ZodType>(item: T) {
  return z.preprocess((value) => {
    if (value === undefined || value === '') return undefined;
    const values = (Array.isArray(value) ? value : [value]).flatMap((v) => String(v).split(','));
    const cleaned = values.map((v) => v.trim()).filter(Boolean);
    return cleaned.length ? cleaned : undefined;
  }, z.array(item).max(50).optional());
}

export const employeeListQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v ? v : undefined)),
  country: listParam(countryCodeSchema),
  department: listParam(id),
  jobTitle: listParam(id),
  status: listParam(z.enum(EMPLOYEE_STATUSES)),
  sort: z.enum(EMPLOYEE_SORT_FIELDS).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
});
export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;

export const initialCompensationSchema = z.object({
  amount: amountSchema,
  currencyCode: currencyCodeSchema,
  /** Defaults to the hire date. */
  effectiveFrom: isoDateSchema.optional(),
  reason: z.enum(COMPENSATION_REASONS).default('NEW_HIRE'),
  note: z.string().trim().max(500).optional(),
});

export const createEmployeeRequestSchema = z.object({
  employeeCode: employeeCodeSchema,
  firstName: name,
  lastName: name,
  email,
  countryCode: countryCodeSchema,
  departmentId: id,
  jobTitleId: id,
  hireDate: isoDateSchema,
  status: z.enum(ASSIGNABLE_STATUSES).default('ACTIVE'),
  initialCompensation: initialCompensationSchema,
});
export type CreateEmployeeRequest = z.infer<typeof createEmployeeRequestSchema>;

export const updateEmployeeRequestSchema = z
  .object({
    version,
    firstName: name.optional(),
    lastName: name.optional(),
    email: email.optional(),
    countryCode: countryCodeSchema.optional(),
    departmentId: id.optional(),
    jobTitleId: id.optional(),
    hireDate: isoDateSchema.optional(),
    status: z.enum(ASSIGNABLE_STATUSES).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).some((key) => key !== 'version'), {
    message: 'Provide at least one field to change',
  });
export type UpdateEmployeeRequest = z.infer<typeof updateEmployeeRequestSchema>;

export const deactivateEmployeeRequestSchema = z.object({
  version,
  terminationDate: isoDateSchema,
  reason: reasonText,
});
export type DeactivateEmployeeRequest = z.infer<typeof deactivateEmployeeRequestSchema>;

export const reactivateEmployeeRequestSchema = z.object({
  version,
  reason: reasonText,
});
export type ReactivateEmployeeRequest = z.infer<typeof reactivateEmployeeRequestSchema>;

// ---------- Compensation ----------

export const createCompensationRequestSchema = z.object({
  amount: amountSchema,
  currencyCode: currencyCodeSchema,
  effectiveFrom: isoDateSchema,
  reason: z.enum(COMPENSATION_REASONS),
  note: z.string().trim().max(500).optional(),
});
export type CreateCompensationRequest = z.infer<typeof createCompensationRequestSchema>;

export const correctCompensationRequestSchema = z
  .object({
    version,
    amount: amountSchema.optional(),
    currencyCode: currencyCodeSchema.optional(),
    effectiveFrom: isoDateSchema.optional(),
    reason: z.enum(COMPENSATION_REASONS).optional(),
    note: z.string().trim().max(500).nullable().optional(),
    /** Why history is being changed; stored in the audit trail. */
    correctionReason: reasonText,
  })
  .strict()
  .refine(
    (body) =>
      ['amount', 'currencyCode', 'effectiveFrom', 'reason', 'note'].some(
        (key) => body[key as keyof typeof body] !== undefined,
      ),
    { message: 'Provide at least one field to correct' },
  );
export type CorrectCompensationRequest = z.infer<typeof correctCompensationRequestSchema>;

export const auditEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
});
