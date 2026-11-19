import { Router } from 'express';
import {
  distributionQuerySchema,
  histogramQuerySchema,
  recentChangesQuerySchema,
  trendsQuerySchema,
} from '@acme/shared';
import { parseInput } from '../../http/validate.ts';
import { canRead } from '../auth/auth.middleware.ts';
import type { AnalyticsService } from './analytics.service.ts';

export function analyticsRouter(analytics: AnalyticsService): Router {
  const router = Router();
  router.use(canRead);

  router.get('/summary', async (_req, res) => {
    res.json(await analytics.summary());
  });

  router.get('/distribution', async (req, res) => {
    const { dimension, currencyMode } = parseInput(distributionQuerySchema, req.query);
    res.json(await analytics.distribution(dimension, currencyMode));
  });

  router.get('/histogram', async (req, res) => {
    const { currency } = parseInput(histogramQuerySchema, req.query);
    res.json(await analytics.histogram(currency));
  });

  router.get('/trends', async (req, res) => {
    const { months } = parseInput(trendsQuerySchema, req.query);
    res.json(await analytics.trends(months));
  });

  router.get('/recent-changes', async (req, res) => {
    const { limit } = parseInput(recentChangesQuerySchema, req.query);
    res.json({ data: await analytics.recentChanges(limit) });
  });

  return router;
}
