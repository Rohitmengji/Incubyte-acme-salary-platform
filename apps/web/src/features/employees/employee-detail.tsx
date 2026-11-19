'use client';

import { Tabs } from 'radix-ui';
import { ArrowLeft, Pencil, RotateCcw, UserX } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { utcToday } from '@acme/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError } from '@/lib/api';
import { formatDate, formatMoney, tenure } from '@/lib/format';
import { useEmployee } from '@/lib/queries';
import { SalaryHistory } from '@/features/compensation/salary-history';
import { useCurrentUser } from '@/features/shell/app-shell';
import { AuditTrail } from './audit-trail';
import { DeactivateDialog, EditEmployeeDialog, ReactivateDialog } from './employee-dialogs';
import { StatusBadge } from './status-badge';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

const tabClass =
  'border-b-2 border-transparent px-1 pb-2 text-sm font-medium text-slate-600 hover:text-slate-900 data-[state=active]:border-brand-700 data-[state=active]:text-brand-800';

export function EmployeeDetailView({ id }: { id: string }) {
  const employee = useEmployee(id);
  const user = useCurrentUser();
  const [dialog, setDialog] = useState<'edit' | 'deactivate' | 'reactivate' | null>(null);
  const [today] = useState(() => utcToday(new Date()));

  if (employee.isPending) return <LoadingState label="Loading employee" rows={6} />;
  if (employee.error) {
    const notFound = employee.error instanceof ApiError && employee.error.status === 404;
    return (
      <ErrorState
        title={notFound ? 'Employee not found' : 'Could not load this employee'}
        error={employee.error}
        onRetry={notFound ? undefined : () => void employee.refetch()}
      />
    );
  }

  const e = employee.data;
  const inactive = e.status === 'INACTIVE';

  return (
    <div className="space-y-6">
      <Link
        href="/employees"
        className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft aria-hidden="true" className="size-4" /> Employees
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {e.firstName} {e.lastName}
            </h1>
            <StatusBadge status={e.status} />
          </div>
          <p className="mt-1 text-sm text-slate-600">
            <span className="font-mono">{e.employeeCode}</span> · {e.jobTitle.name} ·{' '}
            {e.department.name} · {e.country.name}
          </p>
        </div>
        {user.canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDialog('edit')}>
              <Pencil aria-hidden="true" /> Edit details
            </Button>
            {inactive ? (
              <Button variant="secondary" onClick={() => setDialog('reactivate')}>
                <RotateCcw aria-hidden="true" /> Undo deactivation
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => setDialog('deactivate')}
                className="text-red-700"
              >
                <UserX aria-hidden="true" /> Deactivate
              </Button>
            )}
          </div>
        ) : null}
      </div>

      <Card>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Fact label="Current salary">
              {e.currentCompensation ? (
                <>
                  <span className="tabular text-lg font-semibold">
                    {formatMoney(e.currentCompensation.amount, e.currentCompensation.currency)}
                  </span>
                  <span className="block text-xs text-slate-600">
                    since {formatDate(e.currentCompensation.effectiveFrom)}
                  </span>
                </>
              ) : (
                <span className="text-slate-500">No salary in effect</span>
              )}
            </Fact>
            <Fact label="Hire date">{formatDate(e.hireDate)}</Fact>
            <Fact label={inactive ? 'Tenure (at exit)' : 'Tenure'}>
              {tenure(e.hireDate, e.terminationDate ?? today)}
            </Fact>
            <Fact label="Email">
              <a href={`mailto:${e.email}`} className="break-all text-brand-700 hover:underline">
                {e.email}
              </a>
            </Fact>
            {inactive ? (
              <Fact label="Terminated">{formatDate(e.terminationDate)}</Fact>
            ) : (
              <Fact label="Country">{e.country.name}</Fact>
            )}
          </dl>
        </CardContent>
      </Card>

      <Tabs.Root defaultValue="salary">
        <Tabs.List
          aria-label="Employee sections"
          className="mb-4 flex gap-6 border-b border-slate-200"
        >
          <Tabs.Trigger value="salary" className={tabClass}>
            Salary history
          </Tabs.Trigger>
          <Tabs.Trigger value="audit" className={tabClass}>
            Audit trail
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="salary">
          <SalaryHistory
            employeeId={e.id}
            current={e.currentCompensation}
            canWrite={user.canWrite}
            isInactive={inactive}
          />
        </Tabs.Content>
        <Tabs.Content value="audit">
          <AuditTrail employeeId={e.id} />
        </Tabs.Content>
      </Tabs.Root>

      {user.canWrite ? (
        <>
          <EditEmployeeDialog
            employee={e}
            open={dialog === 'edit'}
            onOpenChange={(open) => setDialog(open ? 'edit' : null)}
          />
          <DeactivateDialog
            employee={e}
            open={dialog === 'deactivate'}
            onOpenChange={(open) => setDialog(open ? 'deactivate' : null)}
          />
          <ReactivateDialog
            employee={e}
            open={dialog === 'reactivate'}
            onOpenChange={(open) => setDialog(open ? 'reactivate' : null)}
          />
        </>
      ) : null}
    </div>
  );
}
