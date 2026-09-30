/**
 * Runs one dashboard test run inside GitHub Actions (.github/workflows/dashboard-run.yml) and reports
 * live progress and final results to the hosted dashboard. It does what services/TestRunner.ts does for the
 * local dashboard, but saves results over HTTP instead of into SQLite.
 *
 * Env: RUN_ID, SUITE, BROWSER, DASHBOARD_URL, DASHBOARD_INGEST_TOKEN, CI_RUN_URL (link to the workflow run).
 * Usage: npx tsx dashboard/backend/ci-run.ts            run the tests and report results
 *        npx tsx dashboard/backend/ci-run.ts --error    report that the job failed before tests could run
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PLAYWRIGHT_CLI, PROJECT_ROOT } from './paths.ts';
import { BrowserId, playwrightArgs, SuiteId } from './suites.ts';
import { importResults } from './services/ResultImporter.ts';

const LOG_TAIL_LINES = 60;
const PROGRESS_INTERVAL_MS = 5000;
const ANSI = /\u001b\[[0-9;]*m/g;
// Same list-reporter parsing as TestRunner.
const RESULT_LINE = /^\s*(✓|✘|-)\s+\d+\s+(.+?)(?:\s+\(retry #\d+\))?(?:\s+\([\d.]+m?s\))?\s*$/;
const RUNNING_LINE = /^Running (\d+) tests?/;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

const runId = required('RUN_ID');
const dashboardUrl = required('DASHBOARD_URL').replace(/\/+$/, '');
const token = required('DASHBOARD_INGEST_TOKEN');
const reportUrl = process.env.CI_RUN_URL?.trim() || null;

async function post(endpoint: 'progress' | 'results', body: unknown): Promise<void> {
  const res = await fetch(`${dashboardUrl}/api/runs/${encodeURIComponent(runId)}/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Dashboard rejected ${endpoint} (${res.status}): ${await res.text()}`);
}

const empty = { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0, duration_ms: 0 };

async function reportJobError(): Promise<void> {
  await post('results', {
    ...empty, status: 'error', exit_code: null, report_url: reportUrl, tests: [],
    error_message: 'The GitHub Actions job failed before the tests could run. Open the workflow run for details.',
  });
}

async function run(): Promise<void> {
  const suite = SuiteId.parse(process.env.SUITE);
  const browser = BrowserId.parse(process.env.BROWSER);
  const dir = path.join(PROJECT_ROOT, 'reports', 'dashboard-run');
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, 'results.json');

  const live = { phase: 'starting' as 'starting' | 'running' | 'importing', expectedTotal: null as number | null,
    passed: 0, failed: 0, skipped: 0, logTail: [] as string[] };
  const results = new Map<string, string>();
  const onLine = (line: string) => {
    if (!line.trim()) return;
    live.logTail.push(line.slice(0, 2000));
    if (live.logTail.length > LOG_TAIL_LINES) live.logTail.shift();
    const running = line.match(RUNNING_LINE);
    if (running) {
      live.expectedTotal = Number(running[1]);
      live.phase = 'running';
      return;
    }
    const result = line.match(RESULT_LINE);
    if (!result) return;
    results.set(result[2], result[1]);
    const values = [...results.values()];
    live.passed = values.filter((v) => v === '✓').length;
    live.failed = values.filter((v) => v === '✘').length;
    live.skipped = values.filter((v) => v === '-').length;
  };

  const sendProgress = () => post('progress', { ...live, reportUrl }).catch((err) => console.warn(err.message));
  await sendProgress();
  const timer = setInterval(() => void sendProgress(), PROGRESS_INTERVAL_MS);

  const child = spawn(process.execPath, [PLAYWRIGHT_CLI, 'test', ...playwrightArgs(suite, browser),
    `--output=${path.join(dir, 'test-results')}`], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PLAYWRIGHT_JSON_OUTPUT_FILE: jsonPath,
      PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(dir, 'html'),
      PLAYWRIGHT_HTML_OPEN: 'never',
      ALLURE_RESULTS_DIR: path.join(dir, 'allure-results'),
      FORCE_COLOR: '0',
    },
  });
  let buffered = '';
  const onData = (chunk: Buffer) => {
    process.stdout.write(chunk);
    buffered += chunk.toString('utf-8');
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) onLine(line.replace(ANSI, ''));
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  if (buffered) onLine(buffered.replace(ANSI, ''));
  clearInterval(timer);
  live.phase = 'importing';
  await sendProgress();

  let imported: ReturnType<typeof importResults> = null;
  let importError: string | null = null;
  try {
    imported = importResults(runId, jsonPath, path.join(PROJECT_ROOT, 'tests'));
  } catch (err) {
    importError = `Could not read Playwright results: ${(err as Error).message}`;
  }
  const tail = live.logTail.join('\n');

  if (!imported || imported.summary.total === 0) {
    const noTests = /No tests found/i.test(tail);
    await post('results', {
      ...empty,
      status: noTests ? 'no_tests' : 'error',
      exit_code: exitCode,
      error_message: noTests ? 'No tests matched this suite yet.'
        : importError ?? imported?.summary.globalError ?? (live.logTail.slice(-15).join('\n') || 'Playwright produced no results.'),
      report_url: reportUrl,
      tests: [],
    });
    return;
  }

  const { summary, tests } = imported;
  await post('results', {
    total: summary.total,
    passed: summary.passed,
    failed: summary.failed,
    skipped: summary.skipped,
    flaky: summary.flaky,
    duration_ms: summary.duration_ms,
    status: summary.failed > 0 || summary.globalError ? 'failed' : 'passed',
    exit_code: exitCode,
    error_message: summary.globalError,
    report_url: reportUrl,
    // Screenshots, videos and traces stay in the workflow run's artifacts (report_url).
    tests: tests.map(({ run_id: _runId, screenshot_url: _s, video_url: _v, trace_url: _t, ...t }) => t),
  });
  console.log(`Reported ${tests.length} results for ${runId} to ${dashboardUrl}`);
}

await (process.argv.includes('--error') ? reportJobError() : run());
