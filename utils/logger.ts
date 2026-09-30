import path from 'path';
import { isoNow } from './dateUtils';
import { appendLine } from './fileUtils';
import { testConfig } from '../config/testConfig';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  runId: string;
  test?: string;
  action: string;
  status?: string;
  error?: string;
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
const minLevel: LogLevel = (process.env.LOG_LEVEL?.toUpperCase() as LogLevel) || 'INFO';

/** One id per `npx playwright test` invocation; set in playwright.config.ts so workers share it. */
export const runId: string = process.env.RUN_ID ?? `local-${Date.now()}`;

const SENSITIVE_KEYS = /pass(word)?|token|secret|api[-_]?key|authorization/i;

/** Basic masking so passwords/tokens never reach the log file. Extended for AI input in Phase 5. */
export function maskSecrets(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [REDACTED]');
  }
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEYS.test(k) ? '[REDACTED]' : maskSecrets(v)]),
    );
  }
  return value;
}

/**
 * A worker runs one test at a time, so the current test is tracked per process. Every log line
 * (including page-object actions) is tagged with it, and captured lines can be attached to the test.
 */
let context: { test?: string; browser?: string } = {};
let captured: LogEntry[] | null = null;

export const logContext = {
  begin(test: string, browser: string): void {
    context = { test, browser };
    captured = [];
  },
  /** Ends the test's context and returns the lines logged during it. */
  end(): LogEntry[] {
    const lines = captured ?? [];
    context = {};
    captured = null;
    return lines;
  },
};

function write(level: LogLevel, action: string, fields: Partial<LogEntry> = {}): void {
  const entry = maskSecrets({ timestamp: isoNow(), level, runId, ...context, action, ...fields }) as LogEntry;
  // Capture everything (DEBUG included) for the per-test attachment; the file honours LOG_LEVEL.
  captured?.push(entry);
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const line = JSON.stringify(entry);
  if (level === 'ERROR') console.error(line);
  else if (process.env.LOG_TO_CONSOLE === 'true') console.log(line);
  appendLine(path.join(testConfig.logsDir, `${runId}.jsonl`), line);
}

export const logger = {
  debug: (action: string, fields?: Partial<LogEntry>) => write('DEBUG', action, fields),
  info: (action: string, fields?: Partial<LogEntry>) => write('INFO', action, fields),
  warn: (action: string, fields?: Partial<LogEntry>) => write('WARN', action, fields),
  error: (action: string, fields?: Partial<LogEntry>) => write('ERROR', action, fields),
};
