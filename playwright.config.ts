import os from 'node:os';
import { defineConfig, devices } from '@playwright/test';
import { config } from './utils/config';
import { testConfig } from './config/testConfig';

const isCI = !!process.env.CI;

// Shared run id for every worker in this invocation (used by logger and, later, the dashboard).
process.env.RUN_ID ??= `run-${Date.now()}`;

/** Browser projects run UI specs; API and AI specs run once in browser-less projects. */
const UI_ONLY = { testIgnore: ['**/api/**', '**/ai/**', '**/ai-demo/**'] };

/**
 * tests/ai-demo fails on purpose, so it only runs when asked for: a CLI argument naming it or AI_DEMO=1.
 * The flag is put in the environment so worker processes (which inherit it) see the same projects.
 */
if (process.argv.some((a) => a.includes('ai-demo'))) process.env.AI_DEMO = '1';
const includeAiDemo = process.env.AI_DEMO === '1';

export default defineConfig({
  testDir: './tests',
  globalSetup: './config/globalSetup.ts',
  outputDir: testConfig.testResultsDir,
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? testConfig.retries.ci : testConfig.retries.local,
  workers: isCI ? testConfig.workers.ci : testConfig.workers.local,
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: testConfig.htmlReportDir, open: 'never' }],
    ['json', { outputFile: `${testConfig.reportsDir}/results.json` }],
    ['allure-playwright', {
      resultsDir: testConfig.allureResultsDir,
      detail: true,
      suiteTitle: true,
      environmentInfo: {
        TEST_ENV: config.testEnv,
        BASE_URL: config.baseUrl,
        API_BASE_URL: config.apiBaseUrl,
        HEADLESS: String(config.headless),
        RUN_ID: process.env.RUN_ID,
        NODE: process.version,
        OS: `${os.type()} ${os.release()}`,
      },
    }],
  ],

  use: {
    baseURL: config.baseUrl,
    headless: config.headless,
    testIdAttribute: 'data-test',
    actionTimeout: config.actionTimeout,
    navigationTimeout: config.navigationTimeout,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },

  // Controlled test API used by tests/api (SauceDemo has no public API).
  webServer: {
    command: 'npx tsx mock-api/server.ts',
    url: `${config.apiBaseUrl}/health`,
    reuseExistingServer: !isCI,
    timeout: 30_000,
    env: { MOCK_API_PORT: new URL(config.apiBaseUrl).port || '3001' },
  },

  projects: [
    { name: 'chromium', ...UI_ONLY, use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', ...UI_ONLY, use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', ...UI_ONLY, use: { ...devices['Desktop Safari'] } },
    { name: 'api', testMatch: 'api/**/*.spec.ts', use: { baseURL: config.apiBaseUrl } },
    { name: 'ai', testMatch: 'ai/**/*.spec.ts' },
    ...(includeAiDemo
      ? [{ name: 'ai-demo', testMatch: 'ai-demo/**/*.spec.ts', retries: 0, use: { ...devices['Desktop Chrome'] } }]
      : []),
  ],
});
