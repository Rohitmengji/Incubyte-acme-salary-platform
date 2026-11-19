// Vercel entry point (zero-config Express, https://vercel.com/docs/frameworks/backend/express): the
// same app as src/server.ts, exported instead of listening, so Vercel runs it as one Function.
// Local development and `npm start` keep using src/server.ts.
import type { Express } from 'express';
import { createApp, createLogger } from './src/app.ts';
import { loadConfig } from './src/config.ts';
import { createPrismaClient } from './src/db.ts';

const config = loadConfig();
const app: Express = createApp({
  config,
  prisma: createPrismaClient(config.databaseUrl),
  logger: createLogger(config.logLevel),
});

export default app;
