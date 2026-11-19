import type { ProblemDetails } from '@acme/shared';

const PROBLEM_BASE = 'https://acme-salary.example/problems/';

export interface FieldError {
  path: string;
  message: string;
}

/** Errors that are safe to show to clients. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly slug: string,
    readonly title: string,
    detail?: string,
    readonly errors?: FieldError[],
  ) {
    super(detail ?? title);
    this.name = new.target.name;
  }

  toProblem(requestId: string): ProblemDetails {
    return {
      type: PROBLEM_BASE + this.slug,
      title: this.title,
      status: this.status,
      ...(this.message !== this.title ? { detail: this.message } : {}),
      requestId,
      ...(this.errors?.length ? { errors: this.errors } : {}),
    };
  }
}

export class ValidationError extends AppError {
  constructor(errors: FieldError[], detail = 'The request contains invalid fields.') {
    super(400, 'validation', 'Invalid request', detail, errors);
  }
}

export class UnauthorizedError extends AppError {
  constructor(detail = 'Please sign in to continue.') {
    super(401, 'unauthorized', 'Authentication required', detail);
  }
}

export class ForbiddenError extends AppError {
  constructor(detail = 'Your role does not allow this action.') {
    super(403, 'forbidden', 'Forbidden', detail);
  }
}

export class NotFoundError extends AppError {
  constructor(what: string) {
    super(404, 'not-found', 'Not found', `${what} was not found.`);
  }
}

export class ConflictError extends AppError {
  constructor(detail: string, errors?: FieldError[], slug = 'conflict') {
    super(409, slug, 'Conflict', detail, errors);
  }
}

/** The record changed since the client read it (optimistic concurrency). */
export class StaleVersionError extends ConflictError {
  constructor(what: string) {
    super(
      `${what} was changed by someone else. Reload to see the latest version, then try again.`,
      undefined,
      'stale-version',
    );
  }
}

/** Well-formed request that breaks a business rule. */
export class BusinessRuleError extends AppError {
  constructor(detail: string, errors?: FieldError[]) {
    super(422, 'business-rule', 'Business rule violated', detail, errors);
  }
}
