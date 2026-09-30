/**
 * Allure 3 report configuration (npx allure generate / open).
 * Plain object export: importing the "allure" package would start its CLI.
 */
export default {
  name: 'AI E-commerce Testing Platform',
  resultsDir: './reports/allure-results',
  output: './reports/allure',
  // Run-to-run trends. Raw results are cleared each run (config/globalSetup.ts); history persists here.
  historyPath: './reports/allure-history.jsonl',
  historyLimit: 30,
  plugins: {
    awesome: {
      options: {
        reportName: 'AI E-commerce Testing Platform',
        reportLanguage: 'en',
        groupBy: ['epic', 'feature', 'story'],
      },
    },
  },
  /**
   * Rule-based failure categories (first match wins). These are regex heuristics on the error text,
   * not root-cause analysis; the AI failure analyzer (Phase 7) is the deeper, evidence-based layer.
   */
  categories: {
    rules: [
      {
        name: 'Infrastructure / environment',
        matchedStatuses: ['failed', 'broken'],
        messageRegex: '.*(browserType\\.launch|missing dependencies|ECONNREFUSED|net::ERR_|getaddrinfo|webServer).*',
      },
      {
        name: 'Locator timeout (possible selector or synchronisation issue)',
        matchedStatuses: ['failed', 'broken'],
        messageRegex: '.*(locator\\.|waiting for (locator|getBy)).*Timeout.*|.*Timeout.*(locator\\.|waiting for (locator|getBy)).*',
      },
      {
        name: 'API contract mismatch (status or schema)',
        matchedStatuses: ['failed', 'broken'],
        messageRegex: '.*(Expected HTTP \\d+|does not match the ".*" schema).*',
      },
      {
        name: 'Assertion failure (possible product defect)',
        matchedStatuses: ['failed'],
      },
      {
        name: 'Test errors (broken tests)',
        matchedStatuses: ['broken'],
      },
    ],
  },
};
