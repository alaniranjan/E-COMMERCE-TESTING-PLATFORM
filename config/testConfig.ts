/** Framework-wide constants that are not environment-specific. */
export const testConfig = {
  reportsDir: 'reports',
  htmlReportDir: 'reports/html',
  /** Raw Allure results. ALLURE_RESULTS_DIR overrides it (the dashboard uses one folder per run). */
  allureResultsDir: process.env.ALLURE_RESULTS_DIR ?? 'reports/allure-results',
  allureReportDir: 'reports/allure',
  testResultsDir: 'test-results',
  logsDir: 'reports/logs',
  retries: { ci: 2, local: 1 },
  workers: { ci: 2, local: undefined as number | undefined },
} as const;

/** Tags used to build suites (Smoke / Regression / UI / API) with --grep. */
export const Tags = {
  smoke: '@smoke',
  regression: '@regression',
  ui: '@ui',
  api: '@api',
  negative: '@negative',
} as const;
