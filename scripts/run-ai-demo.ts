/**
 * npm run test:ai-demo
 * Runs the controlled failures in tests/ai-demo (they fail on purpose), then analyzes them with the
 * configured model and regenerates the Allure report with the AI analysis attached.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { analyzeFailures } from './analyze-failures';

const ROOT = path.resolve(__dirname, '..');
const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });

async function main(): Promise<void> {
  console.log('Running controlled failures (tests/ai-demo). These tests are expected to fail.\n');
  run('npx', ['playwright', 'test', 'tests/ai-demo']);
  console.log('\nAnalyzing failures with AI…\n');
  await analyzeFailures({ rootCause: process.argv.includes('--root-cause'), bugReports: true });
  run('npm', ['run', 'allure:generate', '--silent']);
  console.log('\nAllure report (with "AI failure analysis" and "AI bug report draft" attachments): npm run allure:open');
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
