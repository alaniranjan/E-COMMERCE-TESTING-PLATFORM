import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import type { Run, TestResult, TestStatus } from '../api/types.ts';
import { ErrorAlert, LoadingBlock } from '../components/Feedback.tsx';
import { Icon } from '../components/Icon.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { useApi } from '../hooks/useApi.ts';
import { formatDateTime, formatDuration, passRate, SUITE_LABELS } from '../lib/format.ts';
import { Link } from '../router.tsx';

type Filter = 'all' | TestStatus;

export function RunDetailsPage({ runId }: { runId: string }) {
  const [polling, setPolling] = useState(true);
  const { data, error, loading, refresh } = useApi(() => api.run(runId), [runId], polling ? 2000 : null);
  const [filter, setFilter] = useState<Filter>('all');

  const isRunning = data?.run.status === 'running';
  useEffect(() => {
    if (data && !isRunning) setPolling(false);
  }, [data, isRunning]);

  if (loading && !data) return <LoadingBlock />;
  if (error && !data) return <ErrorAlert message={error} onRetry={refresh} />;
  if (!data) return null;

  const { run, tests } = data;
  const counts = {
    all: tests.length,
    failed: tests.filter((t) => t.status === 'failed').length,
    flaky: tests.filter((t) => t.status === 'flaky').length,
    passed: tests.filter((t) => t.status === 'passed').length,
    skipped: tests.filter((t) => t.status === 'skipped').length,
  };
  const visible = filter === 'all' ? tests : tests.filter((t) => t.status === filter);

  return (
    <>
      <Link href="/history" className="btn btn-ghost btn-sm mb-2 -ml-2">
        <Icon name="arrowLeft" className="size-4" /> Execution History
      </Link>
      <PageHeader
        title={`${SUITE_LABELS[run.suite] ?? run.suite} run`}
        subtitle={<span className="font-mono text-xs">{run.id}</span>}
        actions={<>
          {run.allure_url && (
            <a href={run.allure_url} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
              <Icon name="external" className="size-4" /> Allure report
            </a>
          )}
          {run.report_url && (
            <a href={run.report_url} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
              <Icon name="external" className="size-4" /> Playwright HTML report
            </a>
          )}
        </>}
      />

      <RunSummary run={run} />

      {run.error_message && run.status !== 'passed' && (
        <div role="alert" className={`alert ${run.status === 'no_tests' ? 'alert-warning' : 'alert-error'} alert-soft mt-6 items-start`}>
          <Icon name="info" />
          <pre className="whitespace-pre-wrap font-sans text-sm">{run.error_message}</pre>
        </div>
      )}

      {run.status === 'running' && (
        <div role="alert" className="alert alert-info alert-soft mt-6">
          <span className="loading loading-spinner loading-sm" />
          <span>This run is still in progress.</span>
          <Link href="/run" className="btn btn-sm">Watch live</Link>
        </div>
      )}

      {tests.length > 0 && (
        <div className="card mt-6 bg-base-100 shadow-sm">
          <div className="card-body">
            <div role="tablist" className="tabs tabs-border">
              {(['all', 'failed', 'flaky', 'passed', 'skipped'] as const).map((f) => (
                <button key={f} role="tab" className={`tab gap-2 capitalize ${filter === f ? 'tab-active' : ''}`}
                  onClick={() => setFilter(f)} disabled={f !== 'all' && counts[f] === 0}>
                  {f} <span className="badge badge-sm">{counts[f]}</span>
                </button>
              ))}
            </div>
            <div className="divide-y divide-base-300">
              {visible.map((t) => <TestRow key={t.id} test={t} />)}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function RunSummary({ run }: { run: Run }) {
  const rate = passRate(run);
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="stats stats-vertical bg-base-100 shadow-sm sm:stats-horizontal lg:col-span-2">
        <div className="stat">
          <div className="stat-title">Status</div>
          <div className="stat-value mt-1 text-lg"><StatusBadge status={run.status} size="md" /></div>
          <div className="stat-desc">{rate === null ? 'no executed tests' : `${rate}% pass rate`}</div>
        </div>
        <div className="stat"><div className="stat-title">Total</div><div className="stat-value">{run.total}</div></div>
        <div className="stat"><div className="stat-title">Passed</div><div className="stat-value text-success">{run.passed + run.flaky}</div>
          {run.flaky > 0 && <div className="stat-desc">{run.flaky} flaky</div>}</div>
        <div className="stat"><div className="stat-title">Failed</div><div className={`stat-value ${run.failed ? 'text-error' : ''}`}>{run.failed}</div></div>
        <div className="stat"><div className="stat-title">Skipped</div><div className="stat-value">{run.skipped}</div></div>
      </div>
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body py-4 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-base-content/60">Started</dt><dd>{formatDateTime(run.created_at)}</dd>
            <dt className="text-base-content/60">Duration</dt><dd>{run.status === 'running' ? '…' : formatDuration(run.duration_ms)}</dd>
            <dt className="text-base-content/60">Browser</dt><dd className="capitalize">{run.browser}</dd>
            <dt className="text-base-content/60">Environment</dt><dd>{run.environment}</dd>
            <dt className="text-base-content/60">Base URL</dt><dd className="truncate">{run.base_url}</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}

function TestRow({ test }: { test: TestResult }) {
  const expandable = !!(test.error_message || test.screenshot_url || test.video_url || test.trace_url);
  const tags: string[] = JSON.parse(test.tags);
  const summary = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <StatusBadge status={test.status} />
      <span className="font-medium">{test.title}</span>
      <span className="badge badge-ghost badge-sm capitalize">{test.browser}</span>
      {test.retries > 0 && <span className="badge badge-outline badge-sm">retry {test.retries}</span>}
      <span className="ml-auto flex items-center gap-3 text-xs text-base-content/60">
        {test.screenshot_url && <Icon name="image" className="size-4" />}
        {test.video_url && <Icon name="video" className="size-4" />}
        {test.trace_url && <Icon name="file" className="size-4" />}
        <span className="num">{formatDuration(test.duration_ms)}</span>
      </span>
      <div className="w-full text-xs text-base-content/60">
        {test.file}{test.line ? `:${test.line}` : ''} {tags.join(' ')}
      </div>
    </div>
  );

  if (!expandable) return <div className="px-4 py-3">{summary}</div>;

  return (
    <div className="collapse collapse-arrow rounded-none">
      <input type="checkbox" aria-label={`Details for ${test.title}`} defaultChecked={test.status === 'failed'} />
      <div className="collapse-title px-4 py-3">{summary}</div>
      <div className="collapse-content space-y-4 px-4">
        {test.error_message && (
          <div>
            <h3 className="mb-1 text-sm font-semibold">Error</h3>
            <pre className="max-h-80 overflow-auto rounded-box bg-neutral p-4 text-xs text-neutral-content">{test.error_message}</pre>
          </div>
        )}
        <Artifacts test={test} />
      </div>
    </div>
  );
}

function Artifacts({ test }: { test: TestResult }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  const traceCommand = test.trace_path ? `npx playwright show-trace ${test.trace_path}` : null;

  const copy = async () => {
    if (!traceCommand) return;
    try {
      await navigator.clipboard.writeText(traceCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: the command is still visible to select */ }
  };

  if (!test.screenshot_url && !test.video_url && !test.trace_url) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {test.screenshot_url && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">Screenshot</h3>
          <button className="block overflow-hidden rounded-box border border-base-300" onClick={() => dialog.current?.showModal()}>
            <img src={test.screenshot_url} alt={`Screenshot at failure: ${test.title}`} className="max-h-56 w-full object-cover object-top" loading="lazy" />
          </button>
          <dialog ref={dialog} className="modal">
            <div className="modal-box max-w-5xl">
              <h3 className="mb-3 font-bold">{test.title}</h3>
              <img src={test.screenshot_url} alt={`Screenshot at failure: ${test.title}`} className="w-full" />
            </div>
            <form method="dialog" className="modal-backdrop"><button>close</button></form>
          </dialog>
        </div>
      )}
      {test.video_url && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">Video</h3>
          <video src={test.video_url} controls preload="metadata" className="max-h-56 w-full rounded-box border border-base-300" />
        </div>
      )}
      {test.trace_url && (
        <div className="md:col-span-2">
          <h3 className="mb-1 text-sm font-semibold">Playwright trace</h3>
          <div className="flex flex-wrap items-center gap-2">
            <a href={test.trace_url} download className="btn btn-sm"><Icon name="download" className="size-4" /> Download trace.zip</a>
            {traceCommand && (
              <>
                <code className="rounded bg-base-200 px-2 py-1 text-xs break-all">{traceCommand}</code>
                <button className="btn btn-ghost btn-xs" onClick={copy}>
                  <Icon name={copied ? 'check' : 'copy'} className="size-4" /> {copied ? 'Copied' : 'Copy'}
                </button>
              </>
            )}
          </div>
          <p className="mt-1 text-xs text-base-content/60">Run the command from the project folder, or drop the zip on trace.playwright.dev.</p>
        </div>
      )}
    </div>
  );
}
