export type RunStatus = 'running' | 'passed' | 'failed' | 'no_tests' | 'error' | 'interrupted';
export type TestStatus = 'passed' | 'failed' | 'flaky' | 'skipped';

export interface Run {
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

export interface TestResult {
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

export interface LiveProgress {
  runId: string;
  phase: 'starting' | 'running' | 'importing' | 'completed';
  expectedTotal: number | null;
  passed: number;
  failed: number;
  skipped: number;
  startedAt: string;
  logTail: string[];
}

export interface RunDetails {
  run: Run;
  tests: TestResult[];
  live: LiveProgress | null;
}

export interface Summary {
  latestRun: Run | null;
  totals: { runs: number; tests: number; passed: number; failed: number };
  recentRuns: Run[];
  trend: Run[];
  activeRunId: string | null;
  ai: null;
}

export interface Meta {
  suites: { id: string; label: string; description: string }[];
  browsers: string[];
  settings: { testEnv: string; baseUrl: string };
  activeRunId: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
