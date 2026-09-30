import path from 'node:path';
import fs from 'node:fs';
import { parseEnv } from 'node:util';

/** Root of the test framework (one level above dashboard/). */
export const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');
export const DASHBOARD_ROOT = path.resolve(import.meta.dirname, '..');
export const DB_PATH = path.join(DASHBOARD_ROOT, 'data', 'dashboard.db');
export const FRONTEND_DIST = path.join(DASHBOARD_ROOT, 'frontend', 'dist');
/** Each dashboard run writes screenshots, videos, traces and reports under runs/<runId>/. */
export const RUNS_DIR = path.join(PROJECT_ROOT, 'reports', 'runs');
export const PLAYWRIGHT_CLI = path.join(PROJECT_ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
export const ALLURE_CLI = path.join(PROJECT_ROOT, 'node_modules', 'allure', 'cli.js');

export function runDir(runId: string): string {
  return path.join(RUNS_DIR, runId);
}

/** Absolute artifact path -> URL served under /artifacts, or null if outside RUNS_DIR. */
export function artifactUrl(absPath: string | undefined): string | null {
  if (!absPath) return null;
  const rel = path.relative(RUNS_DIR, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return '/artifacts/' + rel.split(path.sep).map(encodeURIComponent).join('/');
}

/** Only the non-secret settings the dashboard displays. The framework's .env is never modified. */
export function readFrameworkSettings(): { testEnv: string; baseUrl: string } {
  let parsed: Record<string, string> = {};
  try {
    parsed = parseEnv(fs.readFileSync(path.join(PROJECT_ROOT, '.env'), 'utf-8')) as Record<string, string>;
  } catch {
    // No .env: fall back to defaults below.
  }
  return {
    testEnv: parsed.TEST_ENV || 'qa',
    baseUrl: parsed.BASE_URL || 'unknown',
  };
}
