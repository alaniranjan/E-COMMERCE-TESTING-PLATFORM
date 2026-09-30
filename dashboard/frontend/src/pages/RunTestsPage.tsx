import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client.ts';
import type { RunDetails } from '../api/types.ts';
import { ErrorAlert, LoadingBlock } from '../components/Feedback.tsx';
import { Icon } from '../components/Icon.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { useApi } from '../hooks/useApi.ts';
import { formatDuration, SUITE_LABELS } from '../lib/format.ts';
import { Link } from '../router.tsx';

export function RunTestsPage() {
  const { data: meta, error: metaError, refresh: refreshMeta } = useApi(() => api.meta(), []);
  const [suite, setSuite] = useState('smoke');
  const [browser, setBrowser] = useState('chromium');
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Re-attach to a run that is already in progress (e.g. after a page reload).
  useEffect(() => {
    if (meta?.activeRunId && !runId) setRunId(meta.activeRunId);
  }, [meta?.activeRunId, runId]);

  const start = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const { runId: id } = await api.startRun(suite, browser);
      setRunId(id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && typeof err.body.activeRunId === 'string') {
        setRunId(err.body.activeRunId);
      }
      setStartError((err as Error).message);
    } finally {
      setStarting(false);
      void refreshMeta();
    }
  };

  if (metaError && !meta) return <ErrorAlert message={metaError} onRetry={refreshMeta} />;
  if (!meta) return <LoadingBlock />;

  const busy = starting || !!meta.activeRunId;

  return (
    <>
      <PageHeader
        title="Run Tests"
        subtitle={<>Runs Playwright against <span className="font-medium">{meta.settings.baseUrl}</span> ({meta.settings.testEnv}). One run at a time.</>}
      />

      <div className="card bg-base-100 shadow-sm">
        <div className="card-body gap-6">
          <fieldset>
            <legend className="mb-3 font-semibold">1. Choose a suite</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {meta.suites.map((s) => (
                <label key={s.id}
                  className={`card cursor-pointer border-2 transition-colors ${suite === s.id ? 'border-primary bg-primary/5' : 'border-base-300 hover:border-base-content/30'}`}>
                  <div className="card-body gap-1 p-4">
                    <div className="flex items-center gap-2">
                      <input type="radio" name="suite" className="radio radio-primary radio-sm" value={s.id}
                        checked={suite === s.id} onChange={() => setSuite(s.id)} disabled={busy} />
                      <span className="font-semibold">{s.label}</span>
                    </div>
                    <p className="text-xs text-base-content/70">{s.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-3 font-semibold">2. Choose a browser</legend>
            <div className="join" role="radiogroup">
              {meta.browsers.map((b) => (
                <input key={b} type="radio" name="browser" aria-label={b === 'all' ? 'All browsers' : b}
                  className="join-item btn btn-sm capitalize" value={b}
                  checked={browser === b} onChange={() => setBrowser(b)} disabled={busy || suite === 'api'} />
              ))}
            </div>
            {suite === 'api' && <p className="mt-2 text-xs text-base-content/60">API tests do not use a browser.</p>}
          </fieldset>

          <div className="flex flex-wrap items-center gap-4">
            <button className="btn btn-primary btn-lg" onClick={start} disabled={busy}>
              {starting || meta.activeRunId
                ? <><span className="loading loading-spinner" /> {starting ? 'Starting…' : 'Running…'}</>
                : <><Icon name="play" /> RUN TESTS</>}
            </button>
            <code className="text-sm text-base-content/60">
              {commandPreview(suite, browser)}
            </code>
          </div>
          {startError && <ErrorAlert message={startError} />}
        </div>
      </div>

      {runId && <LiveRun key={runId} runId={runId} onDone={refreshMeta} />}
    </>
  );
}

function commandPreview(suite: string, browser: string): string {
  const suiteArgs: Record<string, string> = {
    smoke: '--grep @smoke', regression: '--grep @regression', ui: 'tests/ui', api: 'tests/api', all: '',
  };
  const projects = suite === 'api' ? '--project=api' : browser === 'all' ? '' : `--project=${browser} --project=api --project=ai`;
  return ['npx playwright test', suiteArgs[suite], projects].filter(Boolean).join(' ');
}

const STEPS = ['Starting', 'Running tests', 'Saving results', 'Completed'] as const;

function LiveRun({ runId, onDone }: { runId: string; onDone: () => void }) {
  const [finished, setFinished] = useState(false);
  const { data, error } = useApi(() => api.run(runId), [runId], finished ? null : 1500);

  const running = data?.run.status === 'running';
  useEffect(() => {
    if (data && !running && !finished) {
      setFinished(true);
      onDone();
    }
  }, [data, running, finished, onDone]);

  if (error && !data) return <div className="mt-6"><ErrorAlert message={error} /></div>;
  if (!data) return <div className="mt-6"><LoadingBlock /></div>;

  return (
    <div className="card mt-6 bg-base-100 shadow-sm">
      <div className="card-body gap-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="card-title">
            {SUITE_LABELS[data.run.suite]} · <span className="capitalize">{data.run.browser}</span>
            <StatusBadge status={data.run.status} size="md" />
          </h2>
          <span className="text-sm text-base-content/60">{data.run.id}</span>
        </div>
        {running ? <Progress data={data} /> : <Result data={data} />}
      </div>
    </div>
  );
}

function Progress({ data }: { data: RunDetails }) {
  const live = data.live;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const stepIndex = !live ? 0 : live.phase === 'starting' ? 0 : live.phase === 'running' ? 1 : live.phase === 'importing' ? 2 : 3;
  const done = live ? live.passed + live.failed + live.skipped : 0;
  const total = live?.expectedTotal ?? null;
  const elapsed = now - new Date(data.run.created_at).getTime();

  return (
    <>
      <ul className="steps w-full">
        {STEPS.map((s, i) => <li key={s} className={`step ${i <= stepIndex ? 'step-primary' : ''}`}>{s}</li>)}
      </ul>

      <div>
        <div className="mb-1 flex justify-between text-sm">
          <span>{total ? `${done} of ${total} tests finished` : 'Discovering tests…'}</span>
          <span className="text-base-content/60">{formatDuration(Math.max(0, elapsed))}</span>
        </div>
        {total
          ? <progress className="progress progress-primary w-full" value={done} max={total} />
          : <progress className="progress progress-primary w-full" />}
      </div>

      <div className="stats stats-vertical sm:stats-horizontal bg-base-200">
        <div className="stat"><div className="stat-title">Passed</div><div className="stat-value text-success">{live?.passed ?? 0}</div></div>
        <div className="stat"><div className="stat-title">Failed</div><div className="stat-value text-error">{live?.failed ?? 0}</div></div>
        <div className="stat"><div className="stat-title">Skipped</div><div className="stat-value">{live?.skipped ?? 0}</div></div>
        <div className="stat"><div className="stat-title">Remaining</div><div className="stat-value">{total === null ? '—' : Math.max(0, total - done)}</div></div>
      </div>
      <p className="text-xs text-base-content/60">
        Live counts come from Playwright's console output. A failed test that passes on retry moves to Passed. Final numbers are saved when the run completes.
      </p>

      {live && live.logTail.length > 0 && (
        <div className="collapse collapse-arrow border border-base-300">
          <input type="checkbox" aria-label="Show console output" />
          <div className="collapse-title text-sm font-medium">Console output</div>
          <div className="collapse-content">
            <pre className="max-h-72 overflow-auto rounded-box bg-neutral p-4 text-xs text-neutral-content">{live.logTail.join('\n')}</pre>
          </div>
        </div>
      )}
    </>
  );
}

function Result({ data }: { data: RunDetails }) {
  const { run } = data;
  const tone = run.status === 'passed' ? 'alert-success' : run.status === 'failed' || run.status === 'error' ? 'alert-error' : 'alert-warning';
  const message =
    run.status === 'passed' ? `All ${run.total} tests passed in ${formatDuration(run.duration_ms)}.`
    : run.status === 'failed' ? `${run.failed} of ${run.total} tests failed.`
    : run.error_message ?? 'The run finished without results.';

  return (
    <>
      <ul className="steps w-full">
        {STEPS.map((s) => <li key={s} className="step step-primary">{s}</li>)}
      </ul>
      <div role="alert" className={`alert ${tone} alert-soft`}>
        <Icon name={run.status === 'passed' ? 'check' : 'info'} />
        <span className="whitespace-pre-wrap">{message}</span>
        <Link href={`/runs/${run.id}`} className="btn btn-sm">View results</Link>
      </div>
    </>
  );
}
