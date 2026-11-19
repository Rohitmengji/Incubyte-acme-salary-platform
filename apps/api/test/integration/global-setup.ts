import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { start } from '../../scripts/db.mjs';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Rebuilds the dedicated test database from the real migrations before the integration run. */
export default async function setup(): Promise<void> {
  const url =
    process.env.TEST_DATABASE_URL ?? 'postgresql://acme:acme_local_dev@localhost:54329/acme_test';
  if (new URL(url).pathname.replace('/', '') === 'acme_dev') {
    throw new Error(
      'Refusing to run destructive integration tests against the development database.',
    );
  }
  if (process.env.EMBEDDED_POSTGRES !== '0') await start({ quiet: true });

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
