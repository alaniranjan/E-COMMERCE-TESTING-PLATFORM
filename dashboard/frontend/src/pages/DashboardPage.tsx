import { useState, type CSSProperties } from 'react';
import { api } from '../api/client.ts';
import type { Run } from '../api/types.ts';
import { EmptyState, ErrorAlert, LoadingBlock } from '../components/Feedback.tsx';
import { Icon } from '../components/Icon.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { RunsTable } from '../components/RunsTable.tsx';
import { useApi } from '../hooks/useApi.ts';
import { formatDateTime, formatDuration, passRate, SUITE_LABELS } from '../lib/format.ts';
import { Link, navigate } from '../router.tsx';

export function DashboardPage() {
  const { data, error, loading, refresh } = useApi(() => api.summary(), [], 5000);

  if (loading && !data) return <LoadingBlock />;
  if (error && !data) return <ErrorAlert message={error} onRetry={refresh} />;
  if (!data) return null;

  const run = data.latestRun;
  const runButton = (
    <Link href="/run" className="btn btn-primary"><Icon name="play" className="size-4" /> Run tests</Link>
  );

  if (!run && data.recentRuns.length === 0) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <EmptyState title="No test runs yet" action={runButton}>
          Run a suite and its results, screenshots, videos and traces will be saved here.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={run
          ? <>Latest completed run: {formatDateTime(run.created_at)} · {SUITE_LABELS[run.suite]} · <span className="capitalize">{run.browser}</span></>
          : 'No completed run yet'}
        actions={<>
          {run && <Link href={`/runs/${run.id}`} className="btn btn-ghost">View latest run</Link>}
          {runButton}
        </>}
      />
      {error && <div className="mb-4"><ErrorAlert message={error} /></div>}

      {run && <LatestRunStats run={run} />}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <PassRateCard run={run} totals={data.totals} />
        <TrendCard runs={data.trend} />
      </div>

      <div className="card mt-6 bg-base-100 shadow-sm">
        <div className="card-body">
          <div className="flex items-center justify-between">
            <h2 className="card-title">Recent runs</h2>
            <Link href="/history" className="btn btn-ghost btn-sm">View all</Link>
          </div>
          <RunsTable runs={data.recentRuns} compact />
        </div>
      </div>
    </>
  );
}

function LatestRunStats({ run }: { run: Run }) {
  const rate = passRate(run);
  const executed = run.passed + run.failed + run.flaky;
  const failRate = executed ? Math.round((run.failed / executed) * 100) : 0;
  const tiles = [
    { title: 'Total tests', value: run.total, desc: `${executed} executed` },
    { title: 'Passed', value: run.passed + run.flaky, desc: run.flaky ? `${run.flaky} flaky (passed on retry)` : 'first attempt', cls: 'text-success' },
    { title: 'Failed', value: run.failed, desc: `${failRate}% failure rate`, cls: run.failed ? 'text-error' : '' },
    { title: 'Skipped', value: run.skipped, desc: 'not executed' },
    { title: 'Pass rate', value: rate === null ? '—' : `${rate}%`, desc: 'of executed tests', cls: rate !== null && rate < 100 ? 'text-warning' : 'text-success' },
    { title: 'Duration', value: formatDuration(run.duration_ms), desc: 'wall clock' },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((t) => (
        <div key={t.title} className="stats bg-base-100 shadow-sm">
          <div className="stat">
            <div className="stat-title">{t.title}</div>
            <div className={`stat-value text-3xl ${t.cls ?? ''}`}>{t.value}</div>
            <div className="stat-desc">{t.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PassRateCard({ run, totals }: { run: Run | null; totals: { runs: number; tests: number; passed: number; failed: number } }) {
  const rate = run ? passRate(run) ?? 0 : 0;
  const color = rate === 100 ? 'text-success' : rate >= 80 ? 'text-warning' : 'text-error';
  const overall = totals.passed + totals.failed ? Math.round((totals.passed / (totals.passed + totals.failed)) * 100) : null;
  return (
    <div className="card bg-base-100 shadow-sm">
      <div className="card-body">
        <h2 className="card-title">Pass rate</h2>
        <div className="flex items-center gap-6">
          <div className={`radial-progress ${color}`} role="progressbar" aria-valuenow={rate}
            style={{ '--value': rate, '--size': '7rem', '--thickness': '0.6rem' } as CSSProperties}>
            <span className="text-2xl font-bold text-base-content">{run ? `${rate}%` : '—'}</span>
          </div>
          <dl className="space-y-2 text-sm">
            <div><dt className="text-base-content/60">Latest run</dt><dd className="font-semibold">{run ? `${run.passed + run.flaky} / ${run.passed + run.failed + run.flaky}` : '—'}</dd></div>
            <div><dt className="text-base-content/60">All completed runs ({totals.runs})</dt><dd className="font-semibold">{overall === null ? '—' : `${overall}%`}</dd></div>
          </dl>
        </div>
      </div>
    </div>
  );
}

function TrendCard({ runs }: { runs: Run[] }) {
  const [hovered, setHovered] = useState<Run | null>(null);
  const max = Math.max(1, ...runs.map((r) => r.total));
  const describe = (r: Run) =>
    `${formatDateTime(r.created_at)} · ${SUITE_LABELS[r.suite]} · ${r.browser} · ${r.passed + r.flaky} passed, ${r.failed} failed`;
  return (
    <div className="card bg-base-100 shadow-sm">
      <div className="card-body">
        <h2 className="card-title">Last {runs.length} runs</h2>
        <div className="flex h-32 items-end gap-1.5" onMouseLeave={() => setHovered(null)}>
          {runs.map((r) => {
            const pct = (n: number) => `${(n / max) * 100}%`;
            return (
              <button key={r.id} className="flex h-full flex-1 flex-col justify-end rounded-sm focus-visible:outline-2 focus-visible:outline-primary"
                onMouseEnter={() => setHovered(r)} onFocus={() => setHovered(r)} onBlur={() => setHovered(null)}
                onClick={() => navigate(`/runs/${r.id}`)} aria-label={`Open run: ${describe(r)}`}>
                {r.total === 0
                  ? <div className="h-1 rounded bg-base-content/25" />
                  : <div className={`flex w-full flex-col overflow-hidden rounded-sm ${hovered && hovered.id !== r.id ? 'opacity-50' : ''}`}
                      style={{ height: pct(r.total) }}>
                      <div className="bg-error" style={{ flexGrow: r.failed }} />
                      <div className="bg-base-content/25" style={{ flexGrow: r.skipped }} />
                      <div className="bg-success" style={{ flexGrow: r.passed + r.flaky }} />
                    </div>}
              </button>
            );
          })}
        </div>
        <p className="min-h-5 text-xs text-base-content/70" aria-live="polite">
          {hovered ? describe(hovered) : 'Oldest to newest. Hover or focus a bar for details; click to open.'}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/70">
          <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-success" /> Passed</span>
          <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-error" /> Failed</span>
          <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-base-content/25" /> Skipped / no tests</span>
        </div>
      </div>
    </div>
  );
}
