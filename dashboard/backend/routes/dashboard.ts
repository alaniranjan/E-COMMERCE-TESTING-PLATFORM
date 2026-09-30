import { Router } from 'express';
import { runsRepo } from '../db/repositories.ts';
import { readFrameworkSettings } from '../paths.ts';
import { BROWSERS, SUITES } from '../suites.ts';
import { testRunner } from '../services/TestRunner.ts';

export const dashboardRouter = Router();

dashboardRouter.get('/summary', (_req, res) => {
  res.json({
    latestRun: runsRepo.latestFinished() ?? null,
    totals: runsRepo.totals(),
    recentRuns: runsRepo.recent(8),
    trend: runsRepo.recent(12).reverse(),
    activeRunId: testRunner.activeRunId,
    // AI analysis arrives in Phase 7; null tells the UI it is not available yet (not "zero").
    ai: null,
  });
});

dashboardRouter.get('/meta', (_req, res) => {
  const suites = Object.entries(SUITES).map(([id, s]) => ({ id, label: s.label, description: s.description }));
  res.json({ suites, browsers: BROWSERS, settings: readFrameworkSettings(), activeRunId: testRunner.activeRunId });
});
