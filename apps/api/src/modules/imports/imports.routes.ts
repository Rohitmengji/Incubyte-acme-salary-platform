import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import express from 'express';
import { CSV_COLUMNS, exportQuerySchema, importUploadSchema } from '@acme/shared';
import type { PrismaClient } from '../../db.ts';
import { fromIsoDate, type Clock } from '../../lib/clock.ts';
import { parseInput } from '../../http/validate.ts';
import { canWrite } from '../auth/auth.middleware.ts';
import { parseId } from '../guards.ts';
import { writeAudit, type Actor } from '../audit/audit.ts';
import {
  employeeSelect,
  listOrderBy,
  listWhere,
  toSummary,
} from '../employees/employee.service.ts';
import type { ImportService } from './import.service.ts';
import { toCsvLine } from './csv.ts';

const actor = (req: Request): Actor => ({ userId: req.auth!.userId, requestId: req.requestId });

/** Larger JSON limit for CSV uploads only; everything else keeps the 100 kB default (app.ts). */
export const importBodyParser = express.json({ limit: '5mb' });

export function importsRouter(imports: ImportService): Router {
  const router = Router();
  router.use(canWrite);

  router.post('/', async (req, res) => {
    const preview = await imports.preview(actor(req), parseInput(importUploadSchema, req.body));
    res.status(201).json(preview);
  });

  router.get('/:id', async (req, res) => {
    res.json(await imports.get(parseId(req.params.id, 'Import')));
  });

  router.post('/:id/commit', async (req, res) => {
    res.json(await imports.commit(actor(req), parseId(req.params.id, 'Import')));
  });

  return router;
}

const EXPORT_PAGE = 1_000;

/**
 * Streams the filtered employee list with current salaries. Rows are read inside one REPEATABLE READ
 * transaction so the file is a consistent snapshot even while others are editing.
 */
export function exportsRouter(prisma: PrismaClient, clock: Clock): Router {
  const router = Router();
  router.use(canWrite);

  router.get('/employees.csv', async (req, res) => {
    const query = parseInput(exportQuerySchema, req.query);
    const today = clock.today();
    const where = listWhere(query);
    const orderBy = listOrderBy(query);
    const select = employeeSelect(fromIsoDate(today));

    await prisma.$transaction(
      async (tx) => {
        const total = await tx.employee.count({ where });
        await writeAudit(tx, actor(req), {
          action: 'EMPLOYEES_EXPORTED',
          entityType: 'EXPORT',
          entityId: randomUUID(),
          employeeId: null,
          changes: {
            filters: JSON.parse(JSON.stringify(query)) as Record<string, string>,
            rowCount: total,
          },
        });

        res.status(200);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="acme-employees-${today}.csv"`);
        res.write('\uFEFF'); // lets Excel detect UTF-8 (names such as Zoë)
        res.write(toCsvLine([...CSV_COLUMNS]));
        for (let skip = 0; skip < total; skip += EXPORT_PAGE) {
          const rows = await tx.employee.findMany({
            where,
            orderBy,
            select,
            skip,
            take: EXPORT_PAGE,
          });
          let chunk = '';
          for (const e of rows.map(toSummary)) {
            chunk += toCsvLine([
              e.employeeCode,
              e.firstName,
              e.lastName,
              e.email,
              e.country.code,
              e.department.name,
              e.jobTitle.name,
              e.status,
              e.hireDate,
              e.terminationDate,
              e.currentCompensation?.amount,
              e.currentCompensation?.currency,
              e.currentCompensation?.effectiveFrom,
            ]);
          }
          res.write(chunk);
        }
      },
      { isolationLevel: 'RepeatableRead', timeout: 60_000 },
    );
    res.end();
  });

  return router;
}
