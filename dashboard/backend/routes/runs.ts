import { Router } from 'express';
import { z } from 'zod';
import { runsRepo, testsRepo } from '../db/repositories.ts';
import { BrowserId, SuiteId } from '../suites.ts';
import { RunInProgressError, testRunner } from '../services/TestRunner.ts';

export const runsRouter = Router();

const StartRunBody = z.object({ suite: SuiteId, browser: BrowserId.default('chromium') });
const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  suite: SuiteId.optional(),
  status: z.enum(['running', 'passed', 'failed', 'no_tests', 'error', 'interrupted']).optional(),
});

runsRouter.get('/', (req, res) => {
  const query = ListQuery.safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: 'Invalid query', details: z.treeifyError(query.error) });
  const { page, pageSize, suite, status } = query.data;
  const { items, total } = runsRepo.list({ suite, status, limit: pageSize, offset: (page - 1) * pageSize });
  res.json({ items, total, page, pageSize });
});

runsRouter.post('/', (req, res) => {
  const body = StartRunBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid request body', details: z.treeifyError(body.error) });
  try {
    const runId = testRunner.start(body.data.suite, body.data.browser);
    res.status(202).json({ runId });
  } catch (err) {
    if (err instanceof RunInProgressError) {
      return res.status(409).json({ error: err.message, activeRunId: err.activeRunId });
    }
    throw err;
  }
});

runsRouter.get('/:id', (req, res) => {
  const run = runsRepo.get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json({ run, tests: testsRepo.byRun(run.id), live: testRunner.progress(run.id) });
});
