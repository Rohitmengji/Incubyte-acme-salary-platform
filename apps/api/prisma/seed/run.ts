import { existsSync } from 'node:fs';
import { createPrismaClient } from '../../src/db.ts';
import { seedDatabase, seedPasswordProblems } from './seed.ts';
import { datasetChecksum, generateEmployees } from './generator.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const count = Number(process.env.SEED_EMPLOYEE_COUNT ?? 10_000);
const managerPassword = process.env.SEED_MANAGER_PASSWORD;
const viewerPassword = process.env.SEED_VIEWER_PASSWORD;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl || !managerPassword || !viewerPassword) {
  console.error(
    'DATABASE_URL, SEED_MANAGER_PASSWORD and SEED_VIEWER_PASSWORD must be set (see .env.example).',
  );
  process.exit(1);
}
const unsafe = seedPasswordProblems(process.env, managerPassword, viewerPassword);
if (unsafe.length) {
  console.error(`Refusing to seed: ${unsafe.join(' ')}`);
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_PASSWORDS === '1') {
  console.warn(
    '  ALLOW_DEMO_PASSWORDS=1: published demo passwords are allowed (public demo only).',
  );
}

const prisma = createPrismaClient(databaseUrl);
const started = performance.now();
try {
  const result = await seedDatabase(prisma, {
    count,
    managerPassword,
    viewerPassword,
    log: (message) => console.log(`  ${message}`),
  });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(
    `Seed complete in ${seconds}s: inserted ${result.employeesInserted} employees and ` +
      `${result.compensationsInserted} salary periods; ${result.seededEmployeesPresent}/${count} seeded employees present.`,
  );
  console.log(`Dataset checksum: ${datasetChecksum(generateEmployees({ count }))}`);
  if (result.seededEmployeesPresent !== count) {
    console.error('Seed verification failed: the number of seeded employees does not match.');
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
