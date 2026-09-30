import type { ApiExchangeSummary } from './types';

interface LogLine { timestamp?: string; level?: string; action?: string; [k: string]: unknown }
interface Exchange { method: string; url: string; status: number; durationMs: number; requestBody?: unknown; responseBody?: unknown }

const MAX_LOG_LINES = 15;
const NOISE = new Set(['timestamp', 'level', 'action', 'runId', 'test', 'browser']);

/** The test's own log lines (attached on failure), compacted: warnings/errors plus the most recent lines. */
export function collectLogs(testLogNdjson?: string): string[] {
  if (!testLogNdjson) return [];
  const lines = testLogNdjson.split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) as LogLine; } catch { return undefined; } })
    // test:end repeats the error already given; /__test/ calls are test-harness plumbing (e.g. fault
    // injection) and would reveal how a demo failure was produced.
    .filter((l): l is LogLine => !!l && l.action !== 'test:end' && !JSON.stringify(l).includes('/__test/'));
  // Keep warnings/errors and the most recent lines, in their original (chronological) order.
  const recent = new Set(lines.slice(-MAX_LOG_LINES));
  const chosen = lines.filter((l) => l.level === 'WARN' || l.level === 'ERROR' || recent.has(l)).slice(-MAX_LOG_LINES);
  return chosen.map((l) => {
    const fields = Object.entries(l).filter(([k]) => !NOISE.has(k)).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
    return `${l.level ?? 'INFO'} ${l.action ?? ''} ${fields.join(' ')}`.trim().slice(0, 300);
  });
}

/**
 * API request/response log (already masked by ApiClient). Calls to /__test/ are test-harness
 * plumbing (fault injection, resets), not application traffic, so they are excluded.
 */
export function collectApiExchanges(json?: string): ApiExchangeSummary | undefined {
  if (!json) return undefined;
  let exchanges: Exchange[];
  try { exchanges = JSON.parse(json) as Exchange[]; } catch { return undefined; }
  const app = exchanges.filter((e) => !new URL(e.url).pathname.startsWith('/__test/'));
  if (!app.length) return undefined;
  const lines = app.map((e) => `${e.method} ${new URL(e.url).pathname} -> ${e.status} (${e.durationMs} ms)`);
  const failing = [...app].reverse().find((e) => e.status >= 400);
  return {
    lines: lines.slice(-12),
    failing: failing && {
      request: `${failing.method} ${new URL(failing.url).pathname} ${failing.requestBody ? JSON.stringify(failing.requestBody).slice(0, 300) : ''}`.trim(),
      status: failing.status,
      body: JSON.stringify(failing.responseBody).slice(0, 600),
    },
  };
}

/** The run id recorded in the test's log lines (set by the logger for every Playwright run). */
export function runIdFrom(testLogNdjson?: string): string | undefined {
  const first = testLogNdjson?.split('\n').find(Boolean);
  try { return first ? (JSON.parse(first) as { runId?: string }).runId : undefined; } catch { return undefined; }
}
