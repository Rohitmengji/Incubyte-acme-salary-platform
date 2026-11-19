import { Router } from 'express';
import { correctCompensationRequestSchema, createCompensationRequestSchema } from '@acme/shared';
import { parseInput } from '../../http/validate.ts';
import { canRead, canWrite } from '../auth/auth.middleware.ts';
import { parseId } from '../guards.ts';
import { actor } from '../employees/employee.routes.ts';
import type { CompensationService } from './compensation.service.ts';

/** Mounted at /employees/:id/compensations. */
export function compensationRouter(compensation: CompensationService): Router {
  const router = Router({ mergeParams: true });

  router.get('/', canRead, async (req, res) => {
    const id = parseId((req.params as { id?: string }).id, 'Employee');
    res.json({ data: await compensation.history(id) });
  });

  router.post('/', canWrite, async (req, res) => {
    const id = parseId((req.params as { id?: string }).id, 'Employee');
    const created = await compensation.create(
      actor(req),
      id,
      parseInput(createCompensationRequestSchema, req.body),
    );
    res.status(201).json(created);
  });

  router.patch('/:compensationId', canWrite, async (req, res) => {
    const params = req.params as { id?: string; compensationId?: string };
    const id = parseId(params.id, 'Employee');
    const compensationId = parseId(params.compensationId, 'Salary record');
    const input = parseInput(correctCompensationRequestSchema, req.body);
    res.json(await compensation.correct(actor(req), id, compensationId, input));
  });

  return router;
}
