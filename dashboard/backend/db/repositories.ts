import { db } from './database.ts';

export type RunStatus = 'running' | 'passed' | 'failed' | 'no_tests' | 'error' | 'interrupted';
export type TestStatus = 'passed' | 'failed' | 'flaky' | 'skipped';

export interface RunRow {
  id: string;
  created_at: string;
  finished_at: string | null;
  suite: string;
  browser: string;
  environment: string;
  base_url: string;
  status: RunStatus;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  duration_ms: number;
  ai_analysis_count: number;
  exit_code: number | null;
  error_message: string | null;
  report_url: string | null;
  allure_url: string | null;
}

export interface TestResultRow {
  id: number;
  run_id: string;
  title: string;
  full_title: string;
  file: string;
  line: number | null;
  browser: string;
  status: TestStatus;
  duration_ms: number;
  retries: number;
  tags: string;
  error_message: string | null;
  error_stack: string | null;
  screenshot_url: string | null;
  video_url: string | null;
  trace_url: string | null;
  trace_path: string | null;
}

export type NewTestResult = Omit<TestResultRow, 'id'>;

export interface RunFinish {
  status: RunStatus;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  duration_ms: number;
  exit_code: number | null;
  error_message: string | null;
  report_url: string | null;
  allure_url: string | null;
}

export const runsRepo = {
  create(run: Pick<RunRow, 'id' | 'created_at' | 'suite' | 'browser' | 'environment' | 'base_url'>): void {
    db.prepare(
      `INSERT INTO runs (id, created_at, suite, browser, environment, base_url, status)
       VALUES (?, ?, ?, ?, ?, ?, 'running')`,
    ).run(run.id, run.created_at, run.suite, run.browser, run.environment, run.base_url);
  },

  finish(id: string, result: RunFinish, tests: NewTestResult[]): void {
    const insertTest = db.prepare(
      `INSERT INTO test_results (run_id, title, full_title, file, line, browser, status, duration_ms, retries, tags,
         error_message, error_stack, screenshot_url, video_url, trace_url, trace_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    db.exec('BEGIN');
    try {
      for (const t of tests) {
        insertTest.run(t.run_id, t.title, t.full_title, t.file, t.line, t.browser, t.status, t.duration_ms, t.retries,
          t.tags, t.error_message, t.error_stack, t.screenshot_url, t.video_url, t.trace_url, t.trace_path);
      }
      db.prepare(
        `UPDATE runs SET status = ?, finished_at = ?, total = ?, passed = ?, failed = ?, skipped = ?, flaky = ?,
           duration_ms = ?, exit_code = ?, error_message = ?, report_url = ?, allure_url = ? WHERE id = ?`,
      ).run(result.status, new Date().toISOString(), result.total, result.passed, result.failed, result.skipped,
        result.flaky, result.duration_ms, result.exit_code, result.error_message, result.report_url, result.allure_url, id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },

  /** Runs left as 'running' by a server that stopped mid-run can never finish. */
  markStaleRunsInterrupted(): void {
    db.prepare(
      `UPDATE runs SET status = 'interrupted', error_message = 'Dashboard server stopped while this run was in progress.'
       WHERE status = 'running'`,
    ).run();
  },

  get(id: string): RunRow | undefined {
    return db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
  },

  list(filter: { suite?: string; status?: string; limit: number; offset: number }): { items: RunRow[]; total: number } {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.suite) { where.push('suite = ?'); params.push(filter.suite); }
    if (filter.status) { where.push('status = ?'); params.push(filter.status); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM runs ${clause}`).get(...params) as { n: number }).n;
    const items = db
      .prepare(`SELECT * FROM runs ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, filter.limit, filter.offset) as unknown as RunRow[];
    return { items, total };
  },

  recent(limit: number): RunRow[] {
    return db.prepare('SELECT * FROM runs ORDER BY created_at DESC LIMIT ?').all(limit) as unknown as RunRow[];
  },

  latestFinished(): RunRow | undefined {
    return db
      .prepare(`SELECT * FROM runs WHERE status IN ('passed', 'failed') ORDER BY created_at DESC LIMIT 1`)
      .get() as RunRow | undefined;
  },

  totals(): { runs: number; tests: number; passed: number; failed: number } {
    return db
      .prepare(
        `SELECT COUNT(*) AS runs, COALESCE(SUM(total), 0) AS tests, COALESCE(SUM(passed + flaky), 0) AS passed,
           COALESCE(SUM(failed), 0) AS failed FROM runs WHERE status IN ('passed', 'failed')`,
      )
      .get() as { runs: number; tests: number; passed: number; failed: number };
  },
};

export const testsRepo = {
  byRun(runId: string): TestResultRow[] {
    return db
      .prepare(`SELECT * FROM test_results WHERE run_id = ?
        ORDER BY CASE status WHEN 'failed' THEN 0 WHEN 'flaky' THEN 1 WHEN 'passed' THEN 2 ELSE 3 END, file, line, browser`)
      .all(runId) as unknown as TestResultRow[];
  },

  get(id: number): TestResultRow | undefined {
    return db.prepare('SELECT * FROM test_results WHERE id = ?').get(id) as TestResultRow | undefined;
  },
};
