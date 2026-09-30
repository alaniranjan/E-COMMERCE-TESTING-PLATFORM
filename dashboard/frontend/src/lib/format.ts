export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** Pass rate over executed tests (skipped excluded). Flaky tests passed on retry, so they count as passed. */
export function passRate(run: { passed: number; failed: number; flaky: number }): number | null {
  const executed = run.passed + run.failed + run.flaky;
  return executed ? Math.round(((run.passed + run.flaky) / executed) * 100) : null;
}

export const SUITE_LABELS: Record<string, string> = {
  smoke: 'Smoke', regression: 'Regression', ui: 'UI', api: 'API', all: 'All',
};
