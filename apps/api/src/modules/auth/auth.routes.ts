import { Router, type CookieOptions } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { loginRequestSchema } from '@acme/shared';
import type { AppConfig } from '../../config.ts';
import type { AuthService } from './auth.service.ts';
import { authenticate } from './auth.middleware.ts';
import { parseInput } from '../../http/validate.ts';
import { AppError } from '../../http/errors.ts';
import { readCookie } from '../../http/cookies.ts';

export function authRouter(auth: AuthService, config: AppConfig): Router {
  const router = Router();
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: 'lax',
    path: '/',
  };

  const emailOf = (body: unknown) => {
    const email = (body as { email?: unknown } | undefined)?.email;
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
  };
  const tooMany = new AppError(
    429,
    'rate-limited',
    'Too many requests',
    'Too many sign-in attempts. Please wait a few minutes and try again.',
  );

  // Per account, regardless of client IP: the client IP can be forged or rotated, so this is the
  // control that actually bounds password guessing against one account. It is set higher than the
  // per-IP limit to make deliberate lock-outs of a colleague harder (documented trade-off).
  const accountLimiter = rateLimit({
    windowMs: config.rateLimits.loginWindowMs,
    limit: config.rateLimits.loginPerAccount,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `account|${emailOf(req.body)}`,
    handler: (_req, _res, next) => next(tooMany),
  });

  // Counts failed attempts only, per client IP + email, so one attacker cannot lock out everyone.
  const loginLimiter = rateLimit({
    windowMs: config.rateLimits.loginWindowMs,
    limit: config.rateLimits.loginPerWindow,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? 'unknown')}|${emailOf(req.body)}`,
    handler: (_req, _res, next) => next(tooMany),
  });

  router.post('/login', accountLimiter, loginLimiter, async (req, res) => {
    const credentials = parseInput(loginRequestSchema, req.body);
    const { token, expiresAt, user } = await auth.login(credentials);
    res.cookie(config.cookie.name, token, { ...cookieOptions, expires: expiresAt });
    res.status(200).json({ user, expiresAt: expiresAt.toISOString() });
  });

  router.post('/logout', async (req, res) => {
    const token = readCookie(req, config.cookie.name);
    if (token) await auth.logout(token);
    res.clearCookie(config.cookie.name, cookieOptions);
    res.status(204).end();
  });

  router.get('/me', authenticate(auth, config.cookie.name), (req, res) => {
    const { userId, email, displayName, role } = req.auth!;
    res.json({ user: { id: userId, email, displayName, role } });
  });

  return router;
}
