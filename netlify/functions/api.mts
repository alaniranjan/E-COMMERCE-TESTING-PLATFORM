import { BROWSERS, SUITES } from '../../dashboard/backend/suites.ts';

/**
 * Hosted stand-in for the local dashboard API (dashboard/backend/server.ts).
 * Running Playwright needs local browsers, the mock API and a writable disk, so the
 * hosted dashboard shows an empty history and explains how to run tests locally.
 */
const LOCAL_ONLY =
  'Test runs are only available when the dashboard runs locally (npm run dashboard). The hosted dashboard is read-only.';

const json = (body: unknown, status = 200) => Response.json(body, { status });

export default async (req: Request) => {
  const path = new URL(req.url).pathname.replace(/^\/api/, '').replace(/\/$/, '');

  if (req.method === 'GET' && path === '/dashboard/summary') {
    return json({
      latestRun: null,
      totals: { runs: 0, tests: 0, passed: 0, failed: 0 },
      recentRuns: [],
      trend: [],
      activeRunId: null,
      ai: null,
    });
  }

  if (req.method === 'GET' && path === '/dashboard/meta') {
    const suites = Object.entries(SUITES).map(([id, s]) => ({ id, label: s.label, description: s.description }));
    return json({
      suites,
      browsers: BROWSERS,
      settings: { testEnv: 'hosted', baseUrl: 'local environment only' },
      activeRunId: null,
    });
  }

  if (path === '/runs') {
    if (req.method === 'POST') return json({ error: LOCAL_ONLY }, 501);
    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')) || 20));
    return json({ items: [], total: 0, page, pageSize });
  }

  if (path.startsWith('/runs/')) return json({ error: 'Run not found' }, 404);
  if (path.startsWith('/tests/')) return json({ error: 'Test result not found' }, 404);

  return json({ error: 'Not found' }, 404);
};

export const config = {
  path: '/api/*',
};
