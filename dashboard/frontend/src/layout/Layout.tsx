import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client.ts';
import { Icon, type IconName } from '../components/Icon.tsx';
import { useApi } from '../hooks/useApi.ts';
import { Link, useLocation } from '../router.tsx';

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Dashboard', icon: 'dashboard' },
  { href: '/run', label: 'Run Tests', icon: 'play' },
  { href: '/history', label: 'Execution History', icon: 'history' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  if (href === '/run') return pathname === '/run';
  if (href === '/history') return pathname.startsWith('/history') || pathname.startsWith('/runs/');
  return false;
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'business');
  useEffect(() => {
    const theme = dark ? 'business' : 'corporate';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch { /* storage unavailable */ }
  }, [dark]);
  return (
    <label className="swap swap-rotate btn btn-ghost btn-circle" aria-label="Toggle dark mode">
      <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
      <Icon name="sun" className="swap-off size-5" />
      <Icon name="moon" className="swap-on size-5" />
    </label>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { data: meta } = useApi(() => api.meta(), [pathname], 4000);
  const closeDrawer = () => {
    const toggle = document.getElementById('nav-drawer') as HTMLInputElement | null;
    if (toggle) toggle.checked = false;
  };

  return (
    <div className="drawer lg:drawer-open">
      <input id="nav-drawer" type="checkbox" className="drawer-toggle" />
      <div className="drawer-content flex min-h-screen min-w-0 flex-col bg-base-200">
        <header className="navbar sticky top-0 z-30 border-b border-base-300 bg-base-100 px-4">
          <div className="flex-none lg:hidden">
            <label htmlFor="nav-drawer" className="btn btn-ghost btn-square" aria-label="Open menu">
              <Icon name="menu" />
            </label>
          </div>
          <div className="flex-1 gap-2">
            {meta && (
              <div className="hidden items-center gap-2 text-sm sm:flex">
                <span className="badge badge-outline">{meta.settings.testEnv}</span>
                <span className="text-base-content/60">{meta.settings.baseUrl}</span>
              </div>
            )}
          </div>
          <div className="flex-none gap-2">
            {meta?.activeRunId && (
              <Link href="/run" className="btn btn-sm btn-info btn-soft">
                <span className="loading loading-spinner loading-xs" /> Run in progress
              </Link>
            )}
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-7xl flex-1 p-4 md:p-8">{children}</main>
      </div>

      <div className="drawer-side z-40">
        <label htmlFor="nav-drawer" className="drawer-overlay" aria-label="Close menu" />
        <aside className="flex min-h-full w-64 flex-col border-r border-base-300 bg-base-100">
          <div className="px-6 py-5">
            <Link href="/" className="text-lg font-bold" onClick={closeDrawer}>QA Test Platform</Link>
            <p className="text-xs text-base-content/60">Playwright test automation</p>
          </div>
          <ul className="menu w-full gap-1 px-3">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} onClick={closeDrawer}
                  className={isActive(pathname, item.href) ? 'menu-active' : ''}>
                  <Icon name={item.icon} /> {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
