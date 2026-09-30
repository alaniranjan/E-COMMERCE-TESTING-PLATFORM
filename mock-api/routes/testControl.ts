import { Router } from 'express';
import { ApiError } from '../errors';
import { addFault, clearFaults, FaultSpec } from '../middleware/faults';
import { store } from '../store';
import { parse } from '../validate';

/** Test-only controls. Never part of the "real" API contract; disabled with MOCK_API_TEST_CONTROLS=false. */
export const testControlRouter = Router();

testControlRouter.post('/faults', (req, res) => {
  const scope = req.header('x-fault-scope');
  if (!scope) throw new ApiError(400, 'VALIDATION_ERROR', 'X-Fault-Scope header is required');
  addFault(scope, parse(FaultSpec, req.body));
  res.status(201).json({ scope });
});

testControlRouter.delete('/faults', (req, res) => {
  clearFaults(req.header('x-fault-scope'));
  res.status(204).end();
});

testControlRouter.post('/reset', (_req, res) => {
  store.reset();
  clearFaults();
  res.status(204).end();
});
