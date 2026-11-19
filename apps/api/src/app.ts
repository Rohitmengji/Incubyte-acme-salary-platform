import express, { Router, type RequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { pino, type Logger } from 'pino';
import type { AppConfig } from './config.ts';
import type { PrismaClient } from './db.ts';
import { systemClock, type Clock } from './lib/clock.ts';
import { AppError } from './http/errors.ts';
import { createErrorHandler, notFoundHandler } from './http/error-handler.ts';
import { noStore, originCheck, requestId, requireJsonBody } from './http/middleware.ts';
import { AuthService } from './modules/auth/auth.service.ts';
import { authenticate, canRead, resolveSession } from './modules/auth/auth.middleware.ts';
import { authRouter } from './modules/auth/auth.routes.ts';
import { referenceRouter } from './modules/reference/reference.routes.ts';
import { EmployeeService } from './modules/employees/employee.service.ts';
import { employeesRouter } from './modules/employees/employee.routes.ts';
import { CompensationService } from './modules/compensation/compensation.service.ts';
import { compensationRouter } from './modules/compensation/compensation.routes.ts';
import { AnalyticsService } from './modules/analytics/analytics.service.ts';
import { analyticsRouter } from './modules/analytics/analytics.routes.ts';
import { ImportService } from './modules/imports/import.service.ts';
import {
  exportsRouter,
  importBodyParser,
  importsRouter,
} from './modules/imports/imports.routes.ts';

export interface AppDependencies {
  config: AppConfig;
  prisma: PrismaClient;
  clock?: Clock;
  logger?: Logger;
}

/** Fields that must never reach logs: credentials, session cookies. Bodies are not logged at all. */
export const LOG_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
];

export function createLogger(level: string): Logger {
  return pino({ level, redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' } });
}

/** Composition root: wires services with their dependencies (no DI container needed). */
export function createApp({
  config,
  prisma,
  clock = systemClock,
  logger = createLogger(config.logLevel),
}: AppDependencies) {
  const authService = new AuthService(prisma, clock, config.sessionTtlMs);
  const employeeService = new EmployeeService(prisma, clock);
  const compensationService = new CompensationService(prisma, clock);
  const analyticsService = new AnalyticsService(prisma, clock);
  const importService = new ImportService(prisma, clock);

  const app = express();
  app.set('trust proxy', config.trustProxyHops);
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: config.allowedOrigins, credentials: true }));

  const health: RequestHandler = async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', database: 'up' });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'down' });
    }
  };
  app.get('/health', health);

  const smallJsonBody = express.json({ limit: '100kb' });
  const api = Router();
  api.use(
    noStore,
    // Sessions are resolved before rate limiting so signed-in traffic is limited per session (below).
    cookieParser(),
    resolveSession(authService, config.cookie.name),
    rateLimit({
      windowMs: 60_000,
      limit: config.rateLimits.apiPerMinute,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      // Per *valid* session when signed in: behind a proxy many colleagues share one IP, and a forged
      // X-Forwarded-For must not grant a fresh budget. Anything else - including made-up cookie
      // values, which would otherwise each get their own budget - is limited by IP.
      keyGenerator: (req) =>
        req.auth ? `session:${req.auth.sessionId}` : `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`,
      handler: (_req, _res, next) =>
        next(
          new AppError(
            429,
            'rate-limited',
            'Too many requests',
            'Too many requests. Please slow down.',
          ),
        ),
    }),
    originCheck(config.allowedOrigins),
    requireJsonBody,
    // CSV uploads (JSON envelope) get a larger limit; every other body is capped at 100 kB.
    // Normalised like Express routing (case-insensitive, optional trailing slash), so '/imports/'
    // reaches the same route with the same limit.
    (req, res, next) =>
      req.method === 'POST' && req.path.toLowerCase().replace(/\/+$/, '') === '/imports'
        ? importBodyParser(req, res, next)
        : smallJsonBody(req, res, next),
  );
  api.get('/health', health);
  api.use('/auth', authRouter(authService, config));

  const requireSession = authenticate(authService, config.cookie.name);
  api.use('/reference-data', requireSession, canRead, referenceRouter(prisma));
  api.use('/employees/:id/compensations', requireSession, compensationRouter(compensationService));
  api.use('/employees', requireSession, employeesRouter(employeeService));
  api.use('/analytics', requireSession, analyticsRouter(analyticsService));
  api.use('/imports', requireSession, importsRouter(importService));
  api.use('/exports', requireSession, exportsRouter(prisma, clock));

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}
