import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { AppError, ConflictError, NotFoundError, BusinessRuleError } from './errors.ts';

interface PgErrorInfo {
  /** PostgreSQL SQLSTATE, e.g. 23505 unique_violation, 23P01 exclusion_violation. */
  sqlState?: string;
  constraint?: string;
}

/**
 * Prisma 7 with driver adapters reports database errors in two shapes (verified against PG 18):
 * PrismaClientKnownRequestError with meta.driverAdapterError.cause, or - for deferred constraints
 * that fail at COMMIT - a bare DriverAdapterError whose cause carries the SQLSTATE.
 */
export function pgErrorInfo(error: unknown): PgErrorInfo {
  if (!error || typeof error !== 'object') return {};
  const e = error as {
    meta?: { driverAdapterError?: { cause?: Record<string, unknown> } };
    cause?: Record<string, unknown>;
    message?: string;
  };
  const cause = e.meta?.driverAdapterError?.cause ?? e.cause ?? {};
  const sqlState = (cause.originalCode ?? cause.code) as string | undefined;
  const constraintObj = cause.constraint as { index?: string } | undefined;
  const message = [cause.originalMessage, cause.message, e.message].find(
    (value): value is string => typeof value === 'string',
  );
  const fromMessage = message ? /constraint "([^"]+)"/.exec(message)?.[1] : undefined;
  return { sqlState, constraint: constraintObj?.index ?? fromMessage };
}

const UNIQUE_MESSAGES: Record<string, { path: string; message: string }> = {
  employee_employee_code_key: {
    path: 'employeeCode',
    message: 'An employee with this ID already exists',
  },
  employee_email_key: { path: 'email', message: 'An employee with this email already exists' },
  compensation_employee_id_effective_from_key: {
    path: 'effectiveFrom',
    message: 'A salary period already starts on this date',
  },
};

/** Translates known database errors into client-safe AppErrors; returns undefined otherwise. */
export function mapDatabaseError(error: unknown): AppError | undefined {
  const code = (error as { code?: string } | null)?.code;
  const { sqlState, constraint } = pgErrorInfo(error);

  if (code === 'P2002' || sqlState === '23505') {
    const known = constraint ? UNIQUE_MESSAGES[constraint] : undefined;
    return new ConflictError(
      known?.message ?? 'This record already exists.',
      known ? [known] : undefined,
      'duplicate',
    );
  }
  if (sqlState === '23P01') {
    return new ConflictError(
      'Salary periods for this employee would overlap. Reload the salary history and try again.',
      undefined,
      'salary-period-overlap',
    );
  }
  if (code === 'P2025') return new NotFoundError('The requested record');
  if (code === 'P2003' || sqlState === '23503') {
    return new BusinessRuleError('The request refers to a record that does not exist.');
  }
  if (sqlState === '23514') {
    return new BusinessRuleError('The change breaks a data integrity rule.');
  }
  return undefined;
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.path}`));
};

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    const requestId = req.requestId;
    if (res.headersSent) {
      // Part of the response (e.g. a streamed CSV) is already out: a problem body cannot follow.
      // Express's default handler aborts the connection so the client sees a failed download.
      logger.error({ err: error, requestId }, 'Error after the response started');
      return next(error);
    }
    let appError: AppError | undefined =
      error instanceof AppError ? error : mapDatabaseError(error);

    if (!appError) {
      const bodyError = error as {
        type?: string;
        status?: number;
        expose?: boolean;
        message?: string;
      };
      if (bodyError.type === 'entity.parse.failed') {
        appError = new AppError(
          400,
          'malformed-json',
          'Malformed JSON',
          'The request body is not valid JSON.',
        );
      } else if (bodyError.type === 'entity.too.large') {
        appError = new AppError(
          413,
          'payload-too-large',
          'Payload too large',
          'The request body is too large.',
        );
      } else if (
        typeof bodyError.status === 'number' &&
        bodyError.status >= 400 &&
        bodyError.status < 500
      ) {
        // Other client errors from body-parser/http-errors (unsupported charset or encoding,
        // aborted request) or the router (an undecodable %-escape in the path) are the client's
        // fault, not a 500. Only messages marked safe to expose are passed on.
        appError = new AppError(
          bodyError.status,
          'bad-request',
          'Bad request',
          bodyError.expose === true ? bodyError.message : 'The request could not be understood.',
        );
      }
    }

    if (!appError) {
      logger.error({ err: error, requestId }, 'Unhandled error');
      appError = new AppError(
        500,
        'internal',
        'Internal Server Error',
        'Something went wrong. Please try again.',
      );
    } else if (appError.status >= 500) {
      logger.error({ err: error, requestId }, appError.title);
    }

    res
      .status(appError.status)
      .type('application/problem+json')
      .json(appError.toProblem(requestId));
  };
}
