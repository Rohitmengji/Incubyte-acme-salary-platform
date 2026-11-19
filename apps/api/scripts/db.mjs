#!/usr/bin/env node
// Manages the zero-install local PostgreSQL (ADR-0005). Uses the pg_ctl/initdb binaries shipped by
// the embedded-postgres platform packages so the server keeps running between npm commands.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../../..');
const dataRoot = path.join(repoRoot, '.data');
const dataDir = path.join(dataRoot, 'postgres');
const logFile = path.join(dataRoot, 'postgres.log');
const envFile = path.resolve(here, '../.env');
const fileEnv = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};

/**
 * A setting from the environment, else from apps/api/.env (as the README documents). The file is
 * read here rather than loaded into process.env so callers such as Playwright keep their own env.
 */
export function setting(name) {
  return process.env[name] ?? fileEnv[name];
}

export const LOCAL_DB = {
  host: 'localhost',
  port: Number(setting('LOCAL_PG_PORT') ?? 54329),
  // Local-only credentials for a server bound to localhost; not a secret.
  user: 'acme',
  password: 'acme_local_dev',
  databases: ['acme_dev', 'acme_test'],
};

function platformPackage() {
  const os = process.platform === 'win32' ? 'windows' : process.platform;
  return `@embedded-postgres/${os}-${process.arch}`;
}

async function binaries() {
  const pkg = platformPackage();
  try {
    return await import(pkg);
  } catch {
    throw new Error(
      `PostgreSQL binaries for ${process.platform}/${process.arch} were not found (${pkg}). ` +
        'Run `npm install` again, or set EMBEDDED_POSTGRES=0 and point DATABASE_URL at your own PostgreSQL.',
    );
  }
}

function run(cmd, args, { allowFail = false } = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  if (!allowFail && result.status !== 0) {
    throw new Error(`${path.basename(cmd)} failed:\n${result.stderr || result.stdout}`);
  }
  return result;
}

async function isRunning() {
  const { pg_ctl } = await binaries();
  return (
    existsSync(path.join(dataDir, 'PG_VERSION')) &&
    run(pg_ctl, ['status', '-D', dataDir], { allowFail: true }).status === 0
  );
}

async function initialise() {
  const { initdb } = await binaries();
  mkdirSync(dataRoot, { recursive: true });
  const pwFile = path.join(dataRoot, '.pwfile');
  writeFileSync(pwFile, LOCAL_DB.password);
  try {
    run(initdb, [
      '-D',
      dataDir,
      '-U',
      LOCAL_DB.user,
      `--pwfile=${pwFile}`,
      '--auth=scram-sha-256',
      '--encoding=UTF8',
      '--locale=C',
    ]);
  } finally {
    rmSync(pwFile, { force: true });
  }
}

async function ensureDatabases() {
  const client = new pg.Client({ ...LOCAL_DB, database: 'postgres' });
  await client.connect();
  try {
    for (const name of LOCAL_DB.databases) {
      const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
        name,
      ]);
      if (!rowCount) await client.query(`CREATE DATABASE ${name}`);
    }
  } finally {
    await client.end();
  }
}

export async function start({ quiet = false } = {}) {
  if (setting('EMBEDDED_POSTGRES') === '0') {
    if (!quiet) console.log('EMBEDDED_POSTGRES=0: using DATABASE_URL as configured.');
    return;
  }
  if (!(await isRunning())) {
    if (!existsSync(path.join(dataDir, 'PG_VERSION'))) {
      console.log(
        `Initialising local PostgreSQL in ${path.relative(process.cwd(), dataDir) || dataDir} ...`,
      );
      await initialise();
    }
    const { pg_ctl } = await binaries();
    // Not piped: on Windows the server that pg_ctl launches inherits pipe handles, so spawnSync
    // would wait for output that never ends while PostgreSQL keeps running. Output goes to logFile.
    const started = spawnSync(
      pg_ctl,
      [
        'start',
        '-D',
        dataDir,
        '-l',
        logFile,
        '-w',
        '-t',
        '60',
        '-o',
        `-p ${LOCAL_DB.port} -c listen_addresses=localhost`,
      ],
      { stdio: 'ignore', windowsHide: true },
    );
    if (started.status !== 0) {
      const log = existsSync(logFile)
        ? readFileSync(logFile, 'utf8').split(/\r?\n/).slice(-20)
        : [];
      throw new Error(
        `pg_ctl start failed (exit ${started.status ?? started.signal}). Last lines of ${logFile}:\n${log.join('\n')}`,
      );
    }
    if (!quiet) console.log(`Local PostgreSQL started on localhost:${LOCAL_DB.port}.`);
  } else if (!quiet) {
    console.log(`Local PostgreSQL already running on localhost:${LOCAL_DB.port}.`);
  }
  await ensureDatabases();
}

export async function stop() {
  if (!(await isRunning())) return console.log('Local PostgreSQL is not running.');
  const { pg_ctl } = await binaries();
  run(pg_ctl, ['stop', '-D', dataDir, '-m', 'fast', '-w']);
  console.log('Local PostgreSQL stopped.');
}

async function status() {
  console.log((await isRunning()) ? `running on localhost:${LOCAL_DB.port}` : 'stopped');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const commands = { start, stop, status };
  const command = commands[process.argv[2]];
  if (!command) {
    console.error('Usage: db.mjs <start|stop|status>');
    process.exit(2);
  }
  command().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
