import { z } from 'zod';

/** Fixed suite -> Playwright CLI args. Users pick from this list; nothing free-form reaches the command line. */
export const SUITES = {
  smoke: { label: 'Smoke', description: 'Critical-path checks tagged @smoke', args: ['--grep', '@smoke'] },
  regression: { label: 'Regression', description: 'Full regression set tagged @regression', args: ['--grep', '@regression'] },
  ui: { label: 'UI', description: 'All browser tests in tests/ui', args: ['tests/ui'] },
  api: { label: 'API', description: 'REST API tests against the local mock API', args: ['tests/api'] },
  all: { label: 'All', description: 'Every test in the framework', args: [] as string[] },
} as const;

export const BROWSERS = ['chromium', 'firefox', 'webkit', 'all'] as const;

export const SuiteId = z.enum(Object.keys(SUITES) as [keyof typeof SUITES, ...(keyof typeof SUITES)[]]);
export const BrowserId = z.enum(BROWSERS);
export type SuiteId = z.infer<typeof SuiteId>;
export type BrowserId = z.infer<typeof BrowserId>;

/** Projects that do not use a browser; they always run once, whatever browser is chosen. */
const BROWSERLESS_PROJECTS = ['api', 'ai'];

/**
 * A browser choice narrows the UI projects but keeps the browser-less projects,
 * so Smoke/Regression/All still include API and AI-layer tests.
 */
export function playwrightArgs(suite: SuiteId, browser: BrowserId): string[] {
  if (suite === 'api') return [...SUITES.api.args, '--project=api'];
  const projects = browser === 'all' ? [] : [browser, ...BROWSERLESS_PROJECTS].map((p) => `--project=${p}`);
  return [...SUITES[suite].args, ...projects];
}
