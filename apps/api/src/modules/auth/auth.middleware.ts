import type { RequestHandler } from 'express';
import type { UserRole } from '@acme/shared';
import type { AuthService } from './auth.service.ts';
import { ForbiddenError, UnauthorizedError } from '../../http/errors.ts';
import { readCookie } from '../../http/cookies.ts';

/** Requires a valid session cookie; the API is the only trust boundary (ADR-0001). */
export function authenticate(auth: AuthService, cookieName: string): RequestHandler {
  return async (req, _res, next) => {
    const token = readCookie(req, cookieName);
    if (!token) return next(new UnauthorizedError());
    const context = await auth.authenticate(token);
    if (!context)
      return next(new UnauthorizedError('Your session has expired. Please sign in again.'));
    req.auth = context;
    next();
  };
}

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(new UnauthorizedError());
    if (!roles.includes(req.auth.role)) return next(new ForbiddenError());
    next();
  };
}

export const canRead = requireRole('HR_MANAGER', 'HR_VIEWER');
export const canWrite = requireRole('HR_MANAGER');
