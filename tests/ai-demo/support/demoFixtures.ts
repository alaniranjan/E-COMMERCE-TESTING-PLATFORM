import { test as base } from '../../../fixtures/apiFixtures';

/**
 * Simulates a server-side defect for AI-DEMO-003: the controlled test API answers POST /api/orders
 * with 500. It is an automatic fixture, so it appears neither in the test body nor in its parameter
 * list: the evidence the analyzer sees looks like a real backend failure.
 */
export const test = base.extend<{ simulatedOrderServiceOutage: void }>({
  simulatedOrderServiceOutage: [
    async ({ faults }, use) => {
      await faults.inject({ method: 'POST', path: '/api/orders', status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } } });
      await use();
    },
    { auto: true },
  ],
});
export { expect } from '../../../fixtures/apiFixtures';
