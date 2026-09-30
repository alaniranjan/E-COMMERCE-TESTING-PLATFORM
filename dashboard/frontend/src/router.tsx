import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

/** Tiny history-API router: four pages do not need a routing library. */
const listeners = new Set<() => void>();

export function navigate(to: string): void {
  if (to === location.pathname + location.search) return;
  history.pushState(null, '', to);
  listeners.forEach((l) => l());
  window.scrollTo(0, 0);
}

export function useLocation(): { pathname: string; search: URLSearchParams } {
  const [, force] = useState(0);
  useEffect(() => {
    const update = () => force((n) => n + 1);
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return { pathname: location.pathname, search: new URLSearchParams(location.search) };
}

export function Link({ href = '/', onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || props.target) return;
    e.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...props} />;
}
