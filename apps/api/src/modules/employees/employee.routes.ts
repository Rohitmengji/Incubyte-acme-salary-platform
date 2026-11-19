import { Router, type Request } from 'express';
import {
  auditEventsQuerySchema,
  createEmployeeRequestSchema,
  deactivateEmployeeRequestSchema,
  employeeListQuerySchema,
  reactivateEmployeeRequestSchema,
  updateEmployeeRequestSchema,
} from '@acme/shared';
import { parseInput } from '../../http/validate.ts';
import { canRead, canWrite } from '../auth/auth.middleware.ts';
import { parseId } from '../guards.ts';
import type { Actor } from '../audit/audit.ts';
import type { EmployeeService } from './employee.service.ts';

export function actor(req: Request): Actor {
  return { userId: req.auth!.userId, requestId: req.requestId };
}

export function employeesRouter(employees: EmployeeService): Router {
  const router = Router();

  router.get('/', canRead, async (req, res) => {
    res.json(await employees.list(parseInput(employeeListQuerySchema, req.query)));
  });

  router.post('/', canWrite, async (req, res) => {
    const created = await employees.create(
      actor(req),
      parseInput(createEmployeeRequestSchema, req.body),
    );
    res.status(201).location(`${req.baseUrl}/${created.id}`).json(created);
  });

  router.get('/:id', canRead, async (req, res) => {
    res.json(await employees.get(parseId(req.params.id, 'Employee')));
  });

  router.patch('/:id', canWrite, async (req, res) => {
    const id = parseId(req.params.id, 'Employee');
    res.json(
      await employees.update(actor(req), id, parseInput(updateEmployeeRequestSchema, req.body)),
    );
  });

  router.post('/:id/deactivate', canWrite, async (req, res) => {
    const id = parseId(req.params.id, 'Employee');
    res.json(
      await employees.deactivate(
        actor(req),
        id,
        parseInput(deactivateEmployeeRequestSchema, req.body),
      ),
    );
  });

  router.post('/:id/reactivate', canWrite, async (req, res) => {
    const id = parseId(req.params.id, 'Employee');
    res.json(
      await employees.reactivate(
        actor(req),
        id,
        parseInput(reactivateEmployeeRequestSchema, req.body),
      ),
    );
  });

  router.get('/:id/audit-events', canRead, async (req, res) => {
    const id = parseId(req.params.id, 'Employee');
    const { page, pageSize } = parseInput(auditEventsQuerySchema, req.query);
    res.json(await employees.auditEvents(id, page, pageSize));
  });

  return router;
}
