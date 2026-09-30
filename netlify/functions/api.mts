import { createHash, timingSafeEqual } from 'node:crypto';
import type { Config } from '@netlify/functions';
import { and, count, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { runs, test_results } from '../../db/schema.js';
import { BROWSERS, BrowserId, SUITES, SuiteId } from '../../dashboard/backend/suites.ts';

/**
 * Hosted version of the dashboard API (the local one is dashboard/backend/server.ts).
 * Netlify cannot run browsers, so "Run tests" dispatches .github/workflows/dashboard-run.yml;
 * that job reports progress and results back to the /api/runs/:id/* endpoints below.
 *
 * Netlify environment variables:
 *   DASHBOARD_GITHUB_TOKEN  token allowed to run workflows in the repository (Actions: read & write)
 *   DASHBOARD_GITHUB_REPO   "owner/repo"
 *   DASHBOARD_GITHUB_REF    branch to run the workflow on (default: main)
 *   DASHBOARD_INGEST_TOKEN  shared secret; the same value is a GitHub secret the workflow sends back
 *   TEST_ENV, BASE_URL      shown in the dashboard; the workflow uses its own values
 */

const WORKFLOW_FILE = 'dashboard-run.yml';
/** Matches the workflow's timeout-minutes plus queueing slack; older 'running' runs can never finish. */
const STALE_AFTER_MS = 75 * 60_000;
const RUN_STATUSES = ['running', 'passed', 'failed', 'no_tests', 'error', 'interrupted'] as const;

const json = (body: unknown, status = 200) => Response.json(body, { status });
const env = (name: string) => process.env[name]?.trim() || undefined;

function settings() {
  return { testEnv: env('TEST_ENV') ?? 'qa', baseUrl: env('BASE_URL') ?? 'https://www.saucedemo.com' };
}

function missingConfig(): string[] {
  return ['DASHBOARD_GITHUB_TOKEN', 'DASHBOARD_GITHUB_REPO', 'DASHBOARD_INGEST_TOKEN'].filter((n) => !env(n));
}

function authorized(req: Request): boolean {
  const expected = env('DASHBOARD_INGEST_TOKEN');
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || !given) return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(expected), digest(given));
}

async function markStaleRunsInterrupted(): Promise<void> {
  await db.update(runs)
    .set({ status: 'interrupted', finished_at: new Date(), live: null,
      error_message: 'The GitHub Actions job did not report results. Check the workflow run for details.' })
    .where(and(eq(runs.status, 'running'), lt(runs.created_at, new Date(Date.now() - STALE_AFTER_MS))));
}

async function activeRunId(): Promise<string | null> {
  const [row] = await db.select({ id: runs.id }).from(runs).where(eq(runs.status, 'running'))
    .orderBy(desc(runs.created_at)).limit(1);
  return row?.id ?? null;
}

const FINISHED = inArray(runs.status, ['passed', 'failed']);

// ---- Dashboard (read) ----

async function summary() {
  await markStaleRunsInterrupted();
  const [latestRun] = await db.select().from(runs).where(FINISHED).orderBy(desc(runs.created_at)).limit(1);
  const [totals] = await db.select({
    runs: count(),
    tests: sql<number>`coalesce(sum(${runs.total}), 0)::int`,
    passed: sql<number>`coalesce(sum(${runs.passed} + ${runs.flaky}), 0)::int`,
    failed: sql<number>`coalesce(sum(${runs.failed}), 0)::int`,
  }).from(runs).where(FINISHED);
  const recent = await db.select().from(runs).orderBy(desc(runs.created_at)).limit(12);
  return json({
    latestRun: latestRun ?? null,
    totals,
    recentRuns: recent.slice(0, 8),
    trend: [...recent].reverse(),
    activeRunId: await activeRunId(),
    ai: null,
  });
}

async function meta() {
  await markStaleRunsInterrupted();
  const suites = Object.entries(SUITES).map(([id, s]) => ({ id, label: s.label, description: s.description }));
  return json({ suites, browsers: BROWSERS, settings: settings(), activeRunId: await activeRunId() });
}

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  suite: SuiteId.optional(),
  status: z.enum(RUN_STATUSES).optional(),
});

async function listRuns(url: URL) {
  const query = ListQuery.safeParse(Object.fromEntries([...url.searchParams].filter(([, v]) => v)));
  if (!query.success) return json({ error: 'Invalid query', details: z.treeifyError(query.error) }, 400);
  const { page, pageSize, suite, status } = query.data;
  const filters: SQL[] = [];
  if (suite) filters.push(eq(runs.suite, suite));
  if (status) filters.push(eq(runs.status, status));
  const where = filters.length ? and(...filters) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(runs).where(where);
  const items = await db.select().from(runs).where(where).orderBy(desc(runs.created_at))
    .limit(pageSize).offset((page - 1) * pageSize);
  return json({ items, total, page, pageSize });
}

const STATUS_ORDER = sql`case ${test_results.status} when 'failed' then 0 when 'flaky' then 1 when 'passed' then 2 else 3 end`;

async function runDetails(id: string) {
  await markStaleRunsInterrupted();
  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  if (!run) return json({ error: 'Run not found' }, 404);
  const tests = await db.select().from(test_results).where(eq(test_results.run_id, id))
    .orderBy(STATUS_ORDER, test_results.file, test_results.line, test_results.browser);
  const { live, ...rest } = run;
  return json({ run: rest, tests, live: run.status === 'running' ? live ?? null : null });
}

async function testDetails(idParam: string) {
  const id = Number(idParam);
  const [test] = Number.isInteger(id) ? await db.select().from(test_results).where(eq(test_results.id, id)) : [];
  return test ? json(test) : json({ error: 'Test result not found' }, 404);
}

// ---- Start a run (dispatches GitHub Actions) ----

const StartRunBody = z.object({ suite: SuiteId, browser: BrowserId.default('chromium') });

async function startRun(req: Request) {
  const body = StartRunBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: 'Invalid request body', details: z.treeifyError(body.error) }, 400);

  const missing = missingConfig();
  if (missing.length) {
    return json({ error: `Test runs are not set up yet. Add these Netlify environment variables: ${missing.join(', ')}.` }, 503);
  }

  await markStaleRunsInterrupted();
  const active = await activeRunId();
  if (active) return json({ error: `Run ${active} is still in progress.`, activeRunId: active }, 409);

  const { suite, browser } = body.data;
  const createdAt = new Date();
  const runId = `run-${createdAt.toISOString().replace(/[-:]/g, '').replace(/\..+/, '')}-${suite}`;
  const { testEnv, baseUrl } = settings();
  await db.insert(runs).values({
    id: runId, created_at: createdAt, suite, browser, environment: testEnv, base_url: baseUrl, status: 'running',
    live: { runId, phase: 'starting', expectedTotal: null, passed: 0, failed: 0, skipped: 0,
      startedAt: createdAt.toISOString(), logTail: ['Waiting for GitHub Actions to pick up the job…'] },
  });

  const repo = env('DASHBOARD_GITHUB_REPO')!;
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env('DASHBOARD_GITHUB_TOKEN')}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'qa-test-dashboard',
    },
    body: JSON.stringify({
      ref: env('DASHBOARD_GITHUB_REF') ?? 'main',
      inputs: { run_id: runId, suite, browser, dashboard_url: new URL(req.url).origin },
    }),
  });
  if (!res.ok) {
    const detail = ((await res.json().catch(() => ({}))) as { message?: string }).message ?? res.statusText;
    const message = `GitHub rejected the workflow dispatch (${res.status}): ${detail}`;
    await db.update(runs).set({ status: 'error', finished_at: new Date(), live: null, error_message: message })
      .where(eq(runs.id, runId));
    return json({ error: message }, 502);
  }
  return json({ runId }, 202);
}

// ---- Called by the GitHub Actions job ----

const LiveBody = z.object({
  phase: z.enum(['starting', 'running', 'importing', 'completed']),
  expectedTotal: z.number().int().nullable(),
  passed: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  logTail: z.array(z.string().max(2000)).max(100),
  reportUrl: z.string().url().nullable().optional(),
});

async function reportProgress(req: Request, runId: string) {
  const body = LiveBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: 'Invalid progress', details: z.treeifyError(body.error) }, 400);
  const [run] = await db.select({ status: runs.status, created_at: runs.created_at }).from(runs).where(eq(runs.id, runId));
  if (!run) return json({ error: 'Run not found' }, 404);
  if (run.status !== 'running') return json({ error: 'Run already finished' }, 409);
  const { reportUrl, ...live } = body.data;
  await db.update(runs).set({
    live: { runId, startedAt: run.created_at.toISOString(), ...live },
    ...(reportUrl ? { report_url: reportUrl } : {}),
  }).where(eq(runs.id, runId));
  return json({ ok: true });
}

const text = (max: number) => z.string().nullable().transform((s) => (s && s.length > max ? `${s.slice(0, max)}…` : s));
const TestBody = z.object({
  title: z.string().max(1000),
  full_title: z.string().max(2000),
  file: z.string().max(500),
  line: z.number().int().nullable(),
  browser: z.string().max(50),
  status: z.enum(['passed', 'failed', 'flaky', 'skipped']),
  duration_ms: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
  tags: z.string().max(1000),
  error_message: text(20_000),
  error_stack: text(20_000),
  trace_path: z.string().max(500).nullable(),
});
const ResultsBody = z.object({
  status: z.enum(['passed', 'failed', 'no_tests', 'error']),
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  flaky: z.number().int().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
  exit_code: z.number().int().nullable(),
  error_message: text(20_000),
  report_url: z.string().url().nullable(),
  tests: z.array(TestBody).max(5000),
});

async function reportResults(req: Request, runId: string) {
  const body = ResultsBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: 'Invalid results', details: z.treeifyError(body.error) }, 400);
  const [run] = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId));
  if (!run) return json({ error: 'Run not found' }, 404);

  const { tests, ...result } = body.data;
  await db.transaction(async (tx) => {
    // Re-running the report step replaces earlier results instead of duplicating them.
    await tx.delete(test_results).where(eq(test_results.run_id, runId));
    for (let i = 0; i < tests.length; i += 500) {
      await tx.insert(test_results).values(tests.slice(i, i + 500).map((t) => ({ ...t, run_id: runId })));
    }
    await tx.update(runs).set({ ...result, finished_at: new Date(), live: null }).where(eq(runs.id, runId));
  });
  return json({ ok: true });
}

// ---- Router ----

export default async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, '').replace(/\/$/, '');
  const { method } = req;

  try {
    if (method === 'GET' && path === '/dashboard/summary') return await summary();
    if (method === 'GET' && path === '/dashboard/meta') return await meta();
    if (path === '/runs') {
      if (method === 'GET') return await listRuns(url);
      if (method === 'POST') return await startRun(req);
    }

    const ingest = path.match(/^\/runs\/([^/]+)\/(progress|results)$/);
    if (ingest && method === 'POST') {
      if (!authorized(req)) return json({ error: 'Unauthorized' }, 401);
      const runId = decodeURIComponent(ingest[1]);
      return ingest[2] === 'progress' ? await reportProgress(req, runId) : await reportResults(req, runId);
    }

    const run = path.match(/^\/runs\/([^/]+)$/);
    if (run && method === 'GET') return await runDetails(decodeURIComponent(run[1]));
    const test = path.match(/^\/tests\/([^/]+)$/);
    if (test && method === 'GET') return await testDetails(test[1]);

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
};

export const config: Config = {
  path: '/api/*',
};
