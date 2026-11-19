import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { setting, start } from '../../scripts/db.mjs';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** TEST_DATABASE_URL from the environment or apps/api/.env; shared with vitest.config.ts. */
export function testDatabaseUrl(): string {
  return (
    setting('TEST_DATABASE_URL') ?? 'postgresql://acme:acme_local_dev@localhost:54329/acme_test'
  );
}

/** Rebuilds the dedicated test database from the real migrations before the integration run. */
export default async function setup(): Promise<void> {
  const url = testDatabaseUrl();
  // This drops the whole schema, so only a database that is clearly a test database is accepted
  // (an allowlist: a mistyped URL must never reach development or production data).
  const database = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!/(^|_)test(_|$)/.test(database)) {
    throw new Error(
      `Refusing to reset "${database}": integration tests only use databases named like *_test.`,
    );
  }
  if (setting('EMBEDDED_POSTGRES') !== '0') await start({ quiet: true });

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }

  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0)
    throw new Error(`prisma migrate deploy failed:\n${result.stdout}\n${result.stderr}`);
}
