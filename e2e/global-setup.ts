import { spawnSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';
import { start } from '../apps/api/scripts/db.mjs';

/** Rebuilds the isolated e2e database from migrations and seeds the full 10,000 employees. */
export default async function globalSetup(): Promise<void> {
  const url = new URL(
    process.env.E2E_DATABASE_URL ?? 'postgresql://acme:acme_local_dev@localhost:54329/acme_e2e',
  );
  const database = url.pathname.slice(1);
  if (!/^acme_e2e/.test(database))
    throw new Error(`Refusing to reset ${database}: e2e only uses acme_e2e databases.`);
  if (process.env.EMBEDDED_POSTGRES !== '0') await start({ quiet: true });

  const adminUrl = new URL(url.toString());
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${database}`);
  await admin.end();

  const apiDir = path.resolve(import.meta.dirname, '../apps/api');
  const env = { ...process.env, DATABASE_URL: url.toString() };
  for (const args of [
    ['prisma', 'migrate', 'deploy'],
    ['tsx', 'prisma/seed/run.ts'],
  ]) {
    const result = spawnSync('npx', args, {
      cwd: apiDir,
      env,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    if (result.status !== 0)
      throw new Error(`${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  }
}
