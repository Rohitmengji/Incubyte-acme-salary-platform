'use client';

import { useState } from 'react';
import type { AuditEvent } from '@acme/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { formatTimestamp, humanize } from '@/lib/format';
import { useAuditEvents } from '@/lib/queries';

const ACTION_LABELS: Record<string, string> = {
  EMPLOYEE_CREATED: 'Employee created',
  EMPLOYEE_UPDATED: 'Details updated',
  EMPLOYEE_DEACTIVATED: 'Deactivated',
  EMPLOYEE_REACTIVATED: 'Deactivation undone',
  COMPENSATION_CREATED: 'Salary change added',
  COMPENSATION_CORRECTED: 'Salary record corrected',
  COMPENSATION_PERIOD_ADJUSTED: 'Salary period end adjusted',
};

type Changes = {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
  correctionReason?: string;
  cause?: string;
  source?: string;
};

const show = (value: unknown): string =>
  value === null || value === undefined || value === ''
    ? '—'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : `${value as string | number | boolean}`;

function ChangeList({ changes }: { changes: Changes }) {
  const keys = Object.keys(changes.after ?? {});
  return (
    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-slate-700">
      {keys.map((key) => (
        <div key={key} className="contents">
          <dt className="text-slate-500">{humanize(key.replace(/([A-Z])/g, '_$1'))}</dt>
          <dd className="tabular">
            {changes.before && key in changes.before ? (
              <>
                <span className="text-slate-500 line-through">{show(changes.before[key])}</span> →{' '}
                {show(changes.after?.[key])}
              </>
            ) : (
              show(changes.after?.[key])
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function AuditTrail({ employeeId }: { employeeId: string }) {
  const [page, setPage] = useState(1);
  const audit = useAuditEvents(employeeId, page);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Audit trail</CardTitle>
          <CardDescription>
            Every change to this employee and their salary, who made it and when. Entries cannot be
            edited.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {audit.isPending ? (
          <LoadingState label="Loading audit trail" />
        ) : audit.error ? (
          <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
        ) : audit.data.total === 0 ? (
          <EmptyState
            title="No changes recorded yet"
            description="Records loaded by the initial data import have no audit entries."
          />
        ) : (
          <>
            <ol className="space-y-4">
              {audit.data.data.map((event: AuditEvent) => {
                const changes = (event.changes ?? {}) as Changes;
                const why =
                  changes.correctionReason ??
                  changes.reason ??
                  changes.cause ??
                  (changes.source === 'csv-import' ? 'Imported from CSV' : null);
                return (
                  <li key={event.id} className="border-l-2 border-brand-200 pl-4">
                    <p className="text-sm font-medium text-slate-900">
                      {ACTION_LABELS[event.action] ?? humanize(event.action)}
                    </p>
                    <p className="text-xs text-slate-600">
                      {formatTimestamp(event.occurredAt)} · {event.actor?.displayName ?? 'System'}
                    </p>
                    {why ? <p className="mt-1 text-sm text-slate-700">“{why}”</p> : null}
                    <ChangeList changes={changes} />
                  </li>
                );
              })}
            </ol>
            {audit.data.totalPages > 1 ? (
              <div className="mt-4 flex items-center justify-between text-sm">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Newer
                </Button>
                <span>
                  Page {page} of {audit.data.totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= audit.data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Older
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
