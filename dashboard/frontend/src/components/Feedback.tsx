import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';

export function LoadingBlock() {
  return (
    <div className="flex justify-center py-16">
      <span className="loading loading-spinner loading-lg text-primary" />
    </div>
  );
}

export function ErrorAlert({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="alert alert-error alert-soft">
      <Icon name="x" />
      <span>{message}</span>
      {onRetry && <button className="btn btn-sm" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card border border-dashed border-base-300 bg-base-100">
      <div className="card-body items-center py-12 text-center">
        <h2 className="card-title">{title}</h2>
        {children && <p className="max-w-md text-base-content/70">{children}</p>}
        {action && <div className="card-actions mt-2">{action}</div>}
      </div>
    </div>
  );
}
