'use client';

import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { errorMessage } from '@/lib/api';
import { Button } from './button';
import { Skeleton } from './card';

export function LoadingState({ label = 'Loading', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3 py-2">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <Inbox aria-hidden="true" className="size-8 text-slate-400" />
      <p className="font-medium text-slate-900">{title}</p>
      {description ? <p className="max-w-md text-sm text-slate-600">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title = 'Could not load this section',
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center"
    >
      <AlertTriangle aria-hidden="true" className="size-8 text-red-600" />
      <p className="font-medium text-slate-900">{title}</p>
      <p className="max-w-md text-sm text-slate-600">{errorMessage(error)}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
          <RefreshCw aria-hidden="true" /> Try again
        </Button>
      ) : null}
    </div>
  );
}
