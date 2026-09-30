import fs from 'node:fs';
import path from 'node:path';
import { artifactUrl, PROJECT_ROOT } from '../paths.ts';
import type { NewTestResult, RunFinish, TestStatus } from '../db/repositories.ts';

// Minimal slice of Playwright's JSON reporter format that the dashboard needs.
interface PwAttachment { name: string; contentType: string; path?: string }
interface PwError { message?: string; stack?: string }
interface PwResult { status: string; duration: number; retry: number; errors: PwError[]; attachments: PwAttachment[] }
interface PwTest { projectName: string; status: 'expected' | 'unexpected' | 'flaky' | 'skipped'; results: PwResult[] }
interface PwSpec { title: string; file: string; line: number; tags: string[]; tests: PwTest[] }
interface PwSuite { title: string; file: string; specs: PwSpec[]; suites?: PwSuite[] }
interface PwReport {
  suites: PwSuite[];
  errors: PwError[];
  stats: { duration: number; expected: number; unexpected: number; flaky: number; skipped: number };
}

const ANSI = /\u001b\[[0-9;]*m/g;
const stripAnsi = (text: string | undefined) => (text ? text.replace(ANSI, '') : null);

const STATUS: Record<PwTest['status'], TestStatus> = {
  expected: 'passed',
  unexpected: 'failed',
  flaky: 'flaky',
  skipped: 'skipped',
};

export interface ImportedResults {
  summary: Omit<RunFinish, 'exit_code' | 'report_url' | 'allure_url' | 'error_message' | 'status'> & { globalError: string | null };
  tests: NewTestResult[];
}

export function importResults(runId: string, jsonPath: string, testDir: string): ImportedResults | null {
  if (!fs.existsSync(jsonPath)) return null;
  const report = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as PwReport;

  const tests: NewTestResult[] = [];
  const visit = (suite: PwSuite, titlePath: string[]) => {
    const path_ = suite.title && suite.title !== suite.file ? [...titlePath, suite.title] : titlePath;
    for (const spec of suite.specs) {
      for (const test of spec.tests) tests.push(toRow(runId, spec, test, path_, testDir));
    }
    for (const child of suite.suites ?? []) visit(child, path_);
  };
  for (const suite of report.suites) visit(suite, []);

  const { stats } = report;
  return {
    summary: {
      total: stats.expected + stats.unexpected + stats.flaky + stats.skipped,
      passed: stats.expected,
      failed: stats.unexpected,
      flaky: stats.flaky,
      skipped: stats.skipped,
      duration_ms: Math.round(stats.duration),
      globalError: report.errors.length ? stripAnsi(report.errors.map((e) => e.message).join('\n')) : null,
    },
    tests,
  };
}

function toRow(runId: string, spec: PwSpec, test: PwTest, titlePath: string[], testDir: string): NewTestResult {
  const last = test.results[test.results.length - 1];
  // Artifacts come from the last attempt that has them (a flaky test's failed attempt keeps its trace).
  const withArtifacts = [...test.results].reverse().find((r) => r.attachments.length) ?? last;
  const find = (name: string) => withArtifacts?.attachments.find((a) => a.name === name && a.path)?.path;
  const failure = [...test.results].reverse().find((r) => r.errors.length)?.errors[0];
  const tracePath = find('trace');

  return {
    run_id: runId,
    title: spec.title,
    full_title: [...titlePath, spec.title].join(' › '),
    file: path.relative(PROJECT_ROOT, path.join(testDir, spec.file)),
    line: spec.line,
    browser: test.projectName,
    status: STATUS[test.status],
    duration_ms: Math.round(last?.duration ?? 0),
    retries: last?.retry ?? 0,
    tags: JSON.stringify(spec.tags.map((t) => `@${t}`)),
    error_message: stripAnsi(failure?.message),
    error_stack: stripAnsi(failure?.stack),
    screenshot_url: artifactUrl(find('screenshot')),
    video_url: artifactUrl(find('video')),
    trace_url: artifactUrl(tracePath),
    trace_path: tracePath ? path.relative(PROJECT_ROOT, tracePath) : null,
  };
}
