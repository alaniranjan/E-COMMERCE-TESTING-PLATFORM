import { api } from '../api/client.ts';
import { EmptyState, ErrorAlert, LoadingBlock } from '../components/Feedback.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { RunsTable } from '../components/RunsTable.tsx';
import { useApi } from '../hooks/useApi.ts';
import { SUITE_LABELS } from '../lib/format.ts';
import { Link, navigate, useLocation } from '../router.tsx';

const PAGE_SIZE = 15;
const STATUSES = [
  ['passed', 'Passed'], ['failed', 'Failed'], ['no_tests', 'No tests'], ['error', 'Error'],
  ['interrupted', 'Interrupted'], ['running', 'Running'],
] as const;

export function HistoryPage() {
  const { search } = useLocation();
  const page = Math.max(1, Number(search.get('page')) || 1);
  const suite = search.get('suite') ?? '';
  const status = search.get('status') ?? '';

  const { data, error, loading, refresh } = useApi(
    () => api.runs({ page, pageSize: PAGE_SIZE, suite, status }),
    [page, suite, status],
    5000,
  );

  // Filters live in the URL so the back button and shared links keep them.
  const update = (changes: Record<string, string | number>) => {
    const next = new URLSearchParams(search);
    for (const [k, v] of Object.entries(changes)) {
      if (v === '' || v === 1) next.delete(k);
      else next.set(k, String(v));
    }
    const qs = next.toString();
    navigate(`/history${qs ? `?${qs}` : ''}`);
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader title="Execution History" subtitle={data ? `${data.total} run${data.total === 1 ? '' : 's'}` : undefined} />

      <div className="card bg-base-100 shadow-sm">
        <div className="card-body">
          <div className="flex flex-wrap gap-3">
            <select className="select select-sm w-40" aria-label="Filter by suite" value={suite}
              onChange={(e) => update({ suite: e.target.value, page: 1 })}>
              <option value="">All suites</option>
              {Object.entries(SUITE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <select className="select select-sm w-40" aria-label="Filter by status" value={status}
              onChange={(e) => update({ status: e.target.value, page: 1 })}>
              <option value="">All statuses</option>
              {STATUSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            {(suite || status) && (
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/history')}>Clear filters</button>
            )}
          </div>

          {loading && !data && <LoadingBlock />}
          {error && <ErrorAlert message={error} onRetry={refresh} />}
          {data && data.items.length === 0 && (
            <EmptyState title={suite || status ? 'No runs match these filters' : 'No runs yet'}
              action={<Link href="/run" className="btn btn-primary btn-sm">Run tests</Link>} />
          )}
          {data && data.items.length > 0 && <RunsTable runs={data.items} />}

          {pages > 1 && (
            <div className="join mt-2 self-center">
              <button className="join-item btn btn-sm" disabled={page <= 1} onClick={() => update({ page: page - 1 })}>«</button>
              <button className="join-item btn btn-sm pointer-events-none">Page {page} of {pages}</button>
              <button className="join-item btn btn-sm" disabled={page >= pages} onClick={() => update({ page: page + 1 })}>»</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
