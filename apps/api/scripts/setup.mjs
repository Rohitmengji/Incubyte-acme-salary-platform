#!/usr/bin/env node
// One-command local setup for reviewers: env file, local PostgreSQL, migrations, deterministic seed.
//   node scripts/setup.mjs          -> idempotent; safe to run repeatedly
//   node scripts/setup.mjs --reset  -> drops and rebuilds the LOCAL embedded database first
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { LOCAL_DB, start } from './db.mjs';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(apiRoot);
const require = createRequire(import.meta.url);
const reset = process.argv.includes('--reset');

function step(title, cliModule, args) {
  console.log(`\n▸ ${title}`);
  const result = spawnSync(process.execPath, [require.resolve(cliModule), ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`\n✖ ${title} failed.`);
    process.exit(result.status ?? 1);
  }
}

if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  console.log('Created apps/api/.env from .env.example (local development values).');
}
process.loadEnvFile('.env');

console.log('▸ Starting local PostgreSQL');
await start();

if (reset) {
  const url = new URL(process.env.DATABASE_URL ?? '');
  const isLocalEmbedded =
    ['localhost', '127.0.0.1'].includes(url.hostname) && Number(url.port) === LOCAL_DB.port;
  if (!isLocalEmbedded) {
    console.error(
      `Refusing to reset ${url.hostname}:${url.port}: --reset only works on the local embedded PostgreSQL.`,
    );
    process.exit(1);
  }
  const database = url.pathname.slice(1);
  if (!/^[a-z_][a-z0-9_]*$/.test(database))
    throw new Error(`Unexpected database name: ${database}`);
  console.log(`▸ Dropping and recreating local database "${database}"`);
  const admin = new pg.Client({ ...LOCAL_DB, database: 'postgres' });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${database}`);
  await admin.end();
}

step('Generating Prisma client', 'prisma/build/index.js', ['generate']);
step('Applying database migrations', 'prisma/build/index.js', ['migrate', 'deploy']);
step('Seeding 10,000 synthetic employees (idempotent)', 'tsx/cli', ['prisma/seed/run.ts']);

console.log(`
✔ Setup complete.
  Start the API:   npm run dev            (http://localhost:${process.env.PORT ?? 4000})
  Run the tests:   npm test
  Demo sign-in:    hr.manager@acme.example / value of SEED_MANAGER_PASSWORD in apps/api/.env
                   hr.viewer@acme.example  / value of SEED_VIEWER_PASSWORD (read-only)`);
