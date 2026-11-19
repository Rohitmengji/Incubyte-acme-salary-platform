import { Router } from 'express';
import { COMPENSATION_REASONS, EMPLOYEE_STATUSES, type ReferenceData } from '@acme/shared';
import type { PrismaClient } from '../../db.ts';

export function referenceRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const [countries, currencies, departments, jobTitles] = await Promise.all([
      prisma.country.findMany({ orderBy: { name: 'asc' } }),
      prisma.currency.findMany({ orderBy: { code: 'asc' } }),
      prisma.department.findMany({ orderBy: { name: 'asc' } }),
      prisma.jobTitle.findMany({ orderBy: { name: 'asc' } }),
    ]);
    const body: ReferenceData = {
      countries: countries.map(({ code, name, defaultCurrencyCode }) => ({
        code,
        name,
        defaultCurrencyCode,
      })),
      currencies,
      departments,
      jobTitles,
      statuses: EMPLOYEE_STATUSES,
      compensationReasons: COMPENSATION_REASONS,
    };
    res.json(body);
  });

  return router;
}
