import fs from 'node:fs';
import { testConfig } from './testConfig';

/**
 * Runs once before all tests. Clears raw Allure results so a report only shows this run;
 * run-to-run trends come from Allure's history file, not from leftover results.
 */
export default function globalSetup(): void {
  fs.rmSync(testConfig.allureResultsDir, { recursive: true, force: true });
}
