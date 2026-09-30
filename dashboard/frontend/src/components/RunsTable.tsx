import type { Run } from '../api/types.ts';
import { formatDateTime, formatDuration, passRate, SUITE_LABELS, timeAgo } from '../lib/format.ts';
import { navigate } from '../router.tsx';
import { StatusBadge } from './StatusBadge.tsx';

/** Runs list shared by the Dashboard (recent runs) and Execution History. Rows open the run. */
export function RunsTable({ runs, compact = false }: { runs: Run[]; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className={`table ${compact ? 'table-sm' : ''}`}>
        <thead>
          <tr>
            <th>Run</th>
            <th>Suite</th>
            <th>Browser</th>
            {!compact && <th>Environment</th>}
            <th>Status</th>
            <th className="text-right">Passed</th>
            <th className="text-right">Failed</th>
            {!compact && <th className="text-right">Skipped</th>}
            <th className="text-right">Pass rate</th>
            <th className="text-right">Duration</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const rate = passRate(run);
            return (
              <tr key={run.id} className="hover:bg-base-200 cursor-pointer" onClick={() => navigate(`/runs/${run.id}`)}>
                <td>
                  <a href={`/runs/${run.id}`} className="link link-hover font-medium"
                    onClick={(e) => { e.preventDefault(); }}>
                    {formatDateTime(run.created_at)}
                  </a>
                  <div className="text-xs text-base-content/60">{timeAgo(run.created_at)}</div>
                </td>
                <td>{SUITE_LABELS[run.suite] ?? run.suite}</td>
                <td className="capitalize">{run.browser}</td>
                {!compact && <td>{run.environment}</td>}
                <td><StatusBadge status={run.status} /></td>
                <td className="num text-right text-success">{run.passed + run.flaky}</td>
                <td className={`num text-right ${run.failed ? 'text-error font-semibold' : ''}`}>{run.failed}</td>
                {!compact && <td className="num text-right">{run.skipped}</td>}
                <td className="num text-right">{rate === null ? '—' : `${rate}%`}</td>
                <td className="num text-right">{run.status === 'running' ? '…' : formatDuration(run.duration_ms)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
