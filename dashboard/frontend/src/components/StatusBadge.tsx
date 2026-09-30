import type { RunStatus, TestStatus } from '../api/types.ts';

const STYLES: Record<RunStatus | TestStatus, { cls: string; label: string }> = {
  passed: { cls: 'badge-success', label: 'Passed' },
  failed: { cls: 'badge-error', label: 'Failed' },
  flaky: { cls: 'badge-warning', label: 'Flaky' },
  skipped: { cls: 'badge-ghost', label: 'Skipped' },
  running: { cls: 'badge-info', label: 'Running' },
  no_tests: { cls: 'badge-ghost', label: 'No tests' },
  error: { cls: 'badge-error badge-outline', label: 'Error' },
  interrupted: { cls: 'badge-warning badge-outline', label: 'Interrupted' },
};

export function StatusBadge({ status, size = 'sm' }: { status: RunStatus | TestStatus; size?: 'sm' | 'md' }) {
  const { cls, label } = STYLES[status];
  return (
    <span className={`badge ${cls} ${size === 'sm' ? 'badge-sm' : ''} gap-1 whitespace-nowrap`}>
      {status === 'running' && <span className="loading loading-spinner loading-xs" />}
      {label}
    </span>
  );
}
