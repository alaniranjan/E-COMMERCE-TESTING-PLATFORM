import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { runsRepo } from '../db/repositories.ts';
import type { RunStatus } from '../db/repositories.ts';
import { ALLURE_CLI, artifactUrl, PLAYWRIGHT_CLI, PROJECT_ROOT, readFrameworkSettings, runDir } from '../paths.ts';
import { playwrightArgs, type BrowserId, type SuiteId } from '../suites.ts';
import { importResults } from './ResultImporter.ts';

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

export class RunInProgressError extends Error {
  constructor(readonly activeRunId: string) {
    super(`Run ${activeRunId} is still in progress.`);
  }
}

const LOG_TAIL_LINES = 60;
const ALLURE_TIMEOUT_MS = 120_000;
const execFileAsync = promisify(execFile);
const ANSI = /\u001b\[[0-9;]*m/g;
// List reporter line: "  ✘  3 [webkit] › tests/ui/login.spec.ts:32:9 › Suite › Test @tag (retry #1) (1.2s)"
const RESULT_LINE = /^\s*(✓|✘|-)\s+\d+\s+(.+?)(?:\s+\(retry #\d+\))?(?:\s+\([\d.]+m?s\))?\s*$/;
const RUNNING_LINE = /^Running (\d+) tests?/;

/**
 * Runs one Playwright invocation at a time as a child process. Report locations are redirected
 * per run through Playwright's own env vars and --output, so playwright.config.ts is untouched.
 */
class TestRunner {
  private active: { progress: LiveProgress; results: Map<string, '✓' | '✘' | '-'> } | null = null;

  get activeRunId(): string | null {
    return this.active?.progress.runId ?? null;
  }

  progress(runId: string): LiveProgress | null {
    return this.active?.progress.runId === runId ? this.active.progress : null;
  }

  start(suite: SuiteId, browser: BrowserId): string {
    if (this.active) throw new RunInProgressError(this.active.progress.runId);

    const createdAt = new Date();
    const runId = `run-${createdAt.toISOString().replace(/[-:]/g, '').replace(/\..+/, '')}-${suite}`;
    const dir = runDir(runId);
    fs.mkdirSync(dir, { recursive: true });

    const settings = readFrameworkSettings();
    runsRepo.create({
      id: runId,
      created_at: createdAt.toISOString(),
      suite,
      browser,
      environment: settings.testEnv,
      base_url: settings.baseUrl,
    });

    const progress: LiveProgress = {
      runId, phase: 'starting', expectedTotal: null, passed: 0, failed: 0, skipped: 0,
      startedAt: createdAt.toISOString(), logTail: [],
    };
    this.active = { progress, results: new Map() };

    const jsonPath = path.join(dir, 'results.json');
    const htmlDir = path.join(dir, 'html');
    const allureResultsDir = path.join(dir, 'allure-results');
    const logStream = fs.createWriteStream(path.join(dir, 'output.log'));
    const args = [PLAYWRIGHT_CLI, 'test', ...playwrightArgs(suite, browser), `--output=${path.join(dir, 'test-results')}`];

    const child = spawn(process.execPath, args, {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        RUN_ID: runId,
        PLAYWRIGHT_JSON_OUTPUT_FILE: jsonPath,
        PLAYWRIGHT_HTML_OUTPUT_DIR: htmlDir,
        PLAYWRIGHT_HTML_OPEN: 'never',
        ALLURE_RESULTS_DIR: allureResultsDir,
        FORCE_COLOR: '0',
      },
    });

    let buffered = '';
    const onData = (chunk: Buffer) => {
      logStream.write(chunk);
      buffered += chunk.toString('utf-8');
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) this.onLine(line.replace(ANSI, ''));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    let finished = false;
    const finish = async (exitCode: number | null, spawnError?: Error) => {
      if (finished || !this.active || this.active.progress.runId !== runId) return;
      finished = true;
      if (buffered) this.onLine(buffered.replace(ANSI, ''));
      logStream.end();
      progress.phase = 'importing';
      try {
        const allureUrl = spawnError ? null : await this.generateAllure(allureResultsDir, path.join(dir, 'allure'));
        this.saveResults(runId, jsonPath, htmlDir, exitCode, allureUrl, spawnError);
      } catch (err) {
        console.error(`Saving results for ${runId} failed:`, err);
      } finally {
        progress.phase = 'completed';
        this.active = null;
      }
    };
    child.on('error', (err) => void finish(null, err));
    child.on('close', (code) => void finish(code));

    return runId;
  }

  private onLine(line: string): void {
    const active = this.active;
    if (!active || !line.trim()) return;
    const { progress, results } = active;

    progress.logTail.push(line);
    if (progress.logTail.length > LOG_TAIL_LINES) progress.logTail.shift();

    const running = line.match(RUNNING_LINE);
    if (running) {
      progress.expectedTotal = Number(running[1]);
      progress.phase = 'running';
      return;
    }
    const result = line.match(RESULT_LINE);
    if (!result) return;
    // Keyed by test so a retry that passes replaces its earlier failure.
    results.set(result[2], result[1] as '✓' | '✘' | '-');
    const values = [...results.values()];
    progress.passed = values.filter((v) => v === '✓').length;
    progress.failed = values.filter((v) => v === '✘').length;
    progress.skipped = values.filter((v) => v === '-').length;
  }

  /**
   * Builds this run's Allure report. A failure here only means no Allure link; the run's results are still saved.
   * Uses the project's allurerc.mjs, so history (trends) is shared with command-line runs.
   */
  private async generateAllure(resultsDir: string, outputDir: string): Promise<string | null> {
    if (!fs.existsSync(resultsDir) || fs.readdirSync(resultsDir).length === 0) return null;
    this.onLine('Generating Allure report…');
    try {
      await execFileAsync(process.execPath, [ALLURE_CLI, 'generate', resultsDir, '-o', outputDir],
        { cwd: PROJECT_ROOT, timeout: ALLURE_TIMEOUT_MS });
      const index = path.join(outputDir, 'index.html');
      return fs.existsSync(index) ? artifactUrl(index) : null;
    } catch (err) {
      this.onLine(`Allure report generation failed: ${(err as Error).message.split('\n')[0]}`);
      return null;
    }
  }

  private saveResults(runId: string, jsonPath: string, htmlDir: string, exitCode: number | null,
    allureUrl: string | null, spawnError?: Error): void {
    const tail = this.active?.progress.logTail.join('\n') ?? '';
    const reportUrl = fs.existsSync(path.join(htmlDir, 'index.html')) ? artifactUrl(path.join(htmlDir, 'index.html')) : null;
    const empty = { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0, duration_ms: 0 };

    let imported: ReturnType<typeof importResults> = null;
    let importError: string | null = null;
    try {
      imported = importResults(runId, jsonPath, path.join(PROJECT_ROOT, 'tests'));
    } catch (err) {
      importError = `Could not read Playwright results: ${(err as Error).message}`;
    }

    if (!imported || imported.summary.total === 0) {
      const noTests = /No tests found/i.test(tail);
      const status: RunStatus = noTests ? 'no_tests' : 'error';
      const message = spawnError
        ? `Could not start Playwright: ${spawnError.message}`
        : noTests
          ? 'No tests matched this suite yet.'
          : importError ?? imported?.summary.globalError ?? lastLines(tail, 15) ?? 'Playwright produced no results.';
      runsRepo.finish(runId, { ...empty, status, exit_code: exitCode, error_message: message, report_url: reportUrl, allure_url: allureUrl }, []);
      return;
    }

    const { summary, tests } = imported;
    runsRepo.finish(
      runId,
      {
        total: summary.total,
        passed: summary.passed,
        failed: summary.failed,
        skipped: summary.skipped,
        flaky: summary.flaky,
        duration_ms: summary.duration_ms,
        status: summary.failed > 0 || summary.globalError ? 'failed' : 'passed',
        exit_code: exitCode,
        error_message: summary.globalError,
        report_url: reportUrl,
        allure_url: allureUrl,
      },
      tests,
    );
  }
}

function lastLines(text: string, count: number): string | null {
  const lines = text.trim().split('\n');
  return lines.length && lines[0] ? lines.slice(-count).join('\n') : null;
}

export const testRunner = new TestRunner();
