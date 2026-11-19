import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { AppError, ForbiddenError } from './errors.ts';

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Reuses a well-formed incoming X-Request-Id (from the web proxy) or creates one. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

/** Salary data must not be stored by browsers or shared caches. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence in depth on top of SameSite=Lax cookies (ADR-0001): state-changing requests from a
 * browser must come from an allowed origin. Non-browser clients send no Origin and are allowed.
 */
export function originCheck(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    if (!UNSAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (req.get('sec-fetch-site') === 'cross-site' || (origin && !allowed.has(origin))) {
      return next(new ForbiddenError('Cross-site requests are not allowed.'));
    }
    next();
  };
}

/** Bodies of state-changing requests must be JSON; blocks form-encoded cross-site posts. */
export const requireJsonBody: RequestHandler = (req, _res, next) => {
  const hasBody = Number(req.get('content-length') ?? 0) > 0 || req.get('transfer-encoding');
  if (UNSAFE_METHODS.has(req.method) && hasBody && !req.is('application/json')) {
    return next(
      new AppError(
        415,
        'unsupported-media-type',
        'Unsupported Media Type',
        'Send the request body as application/json.',
      ),
    );
  }
  next();
};
