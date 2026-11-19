import { createApp, createLogger } from './app.ts';
import { loadConfig } from './config.ts';
import { createPrismaClient } from './db.ts';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const prisma = createPrismaClient(config.databaseUrl);
const app = createApp({ config, prisma, logger });

const server = app.listen(config.port, () => {
  logger.info(
    { port: config.port, env: config.env },
    `API listening on http://localhost:${config.port}`,
  );
});

function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close(() => {
    prisma
      .$disconnect()
      .catch((error: unknown) => logger.error({ err: error }, 'Error disconnecting Prisma'))
      .finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
