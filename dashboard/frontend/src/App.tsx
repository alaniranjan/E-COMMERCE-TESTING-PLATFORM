import { Layout } from './layout/Layout.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { HistoryPage } from './pages/HistoryPage.tsx';
import { RunDetailsPage } from './pages/RunDetailsPage.tsx';
import { RunTestsPage } from './pages/RunTestsPage.tsx';
import { EmptyState } from './components/Feedback.tsx';
import { Link, useLocation } from './router.tsx';

export function App() {
  const { pathname } = useLocation();
  const runMatch = pathname.match(/^\/runs\/([^/]+)$/);

  let page;
  if (pathname === '/') page = <DashboardPage />;
  else if (pathname === '/run') page = <RunTestsPage />;
  else if (pathname === '/history') page = <HistoryPage />;
  else if (runMatch) page = <RunDetailsPage key={runMatch[1]} runId={decodeURIComponent(runMatch[1])} />;
  else page = <EmptyState title="Page not found" action={<Link href="/" className="btn btn-primary btn-sm">Go to dashboard</Link>} />;

  return <Layout>{page}</Layout>;
}
