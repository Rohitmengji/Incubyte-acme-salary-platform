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

  // Counts failed attempts only, per client IP + email, so one attacker cannot lock out everyone.
  const loginLimiter = rateLimit({
    windowMs: config.rateLimits.loginWindowMs,
    limit: config.rateLimits.loginPerWindow,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const body = req.body as { email?: unknown } | undefined;
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      return `${ipKeyGenerator(req.ip ?? 'unknown')}|${email}`;
    },
    handler: (_req, _res, next) =>
      next(
        new AppError(
          429,
          'rate-limited',
          'Too many requests',
          'Too many sign-in attempts. Please wait a few minutes and try again.',
        ),
      ),
  });

  router.post('/login', loginLimiter, async (req, res) => {
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
