import fs from 'node:fs';
import path from 'node:path';
import type { FailedTest } from './types';

// Minimal slice of Playwright's JSON reporter output.
interface PwAttachment { name: string; contentType: string; path?: string; body?: string }
interface PwResult {
  status: string; duration: number; retry: number; startTime?: string;
  error?: { message?: string; stack?: string; location?: { file: string; line: number; column: number } };
  errors?: { message?: string }[];
  attachments: PwAttachment[];
}
interface PwTest { projectName: string; status: string; results: PwResult[] }
interface PwSpec { id: string; title: string; file: string; line: number; tags?: string[]; tests: PwTest[] }
interface PwSuite { title: string; specs?: PwSpec[]; suites?: PwSuite[] }
interface PwReport { config?: { rootDir?: string }; suites: PwSuite[] }

const ANSI = /\u001b\[[0-9;]*m/g;
const clean = (s?: string) => (s ?? '').replace(ANSI, '');

/**
 * Reads a Playwright JSON report and returns tests that ended unexpectedly (failed, timed out, interrupted).
 * Uses the last attempt, which carries the retained screenshot/video/trace.
 */
export function parseFailedTests(reportPath: string, projectRoot: string): FailedTest[] {
  if (!fs.existsSync(reportPath)) throw new Error(`Playwright JSON report not found: ${reportPath}`);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as PwReport;
  const testDir = report.config?.rootDir ?? path.join(projectRoot, 'tests');
  const failed: FailedTest[] = [];

  const visit = (suite: PwSuite, titles: string[]) => {
    const here = suite.title && !suite.title.endsWith('.ts') ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        if (test.status !== 'unexpected') continue;
        const result = test.results[test.results.length - 1];
        if (!result) continue;
        failed.push(toFailedTest(spec, test, result, here, testDir, projectRoot));
      }
    }
    for (const child of suite.suites ?? []) visit(child, here);
  };
  for (const suite of report.suites) visit(suite, []);
  return failed;
}

function toFailedTest(spec: PwSpec, test: PwTest, result: PwResult, titles: string[], testDir: string, projectRoot: string): FailedTest {
  const find = (name: string) => result.attachments.find((a) => a.name === name);
  const filePath = (name: string) => find(name)?.path;
  const inline = (name: string) => {
    const a = find(name);
    return a?.body ? Buffer.from(a.body, 'base64').toString('utf-8') : undefined;
  };
  const message = clean(result.error?.message ?? result.errors?.map((e) => e.message).join('\n'));

  return {
    key: `${spec.id}:${test.projectName}`,
    testId: spec.id,
    title: spec.title,
    titlePath: [...titles, spec.title],
    file: path.relative(projectRoot, path.join(testDir, spec.file)),
    line: spec.line,
    project: test.projectName,
    tags: (spec.tags ?? []).map((t) => (t.startsWith('@') ? t : `@${t}`)),
    status: result.status,
    retry: result.retry,
    durationMs: Math.round(result.duration),
    startTime: result.startTime,
    error: {
      message: message || `Test ${result.status} without an error message`,
      stack: clean(result.error?.stack) || undefined,
      location: result.error?.location,
    },
    attachments: {
      screenshot: filePath('screenshot'),
      video: filePath('video'),
      trace: filePath('trace'),
      errorContext: filePath('error-context'),
      testLog: inline('test-log.jsonl'),
      apiExchanges: inline('api-exchanges.json'),
    },
  };
}
