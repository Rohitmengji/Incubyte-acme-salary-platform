'use client';

import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import type { CompensationRecord, CurrentCompensation } from '@acme/shared';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate, formatMoney, humanize } from '@/lib/format';
import { useCompensations } from '@/lib/queries';
import { CorrectionDialog } from './correction-dialog';
import { SalaryChangeDialog } from './salary-change-dialog';

export function SalaryHistory({
  employeeId,
  current,
  canWrite,
  isInactive,
}: {
  employeeId: string;
  current: CurrentCompensation | null;
  canWrite: boolean;
  isInactive: boolean;
}) {
  const history = useCompensations(employeeId);
  const [adding, setAdding] = useState(false);
  const [correcting, setCorrecting] = useState<CompensationRecord | null>(null);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Salary history</CardTitle>
          <CardDescription>
            Annual gross base salary. Each period runs until the next one starts.
          </CardDescription>
        </div>
        {canWrite ? (
          <Button
            onClick={() => setAdding(true)}
            disabled={isInactive}
            title={isInactive ? 'Reactivate the employee to add a salary change' : undefined}
          >
            <Plus aria-hidden="true" /> Add salary change
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {history.isPending ? (
          <div className="p-5">
            <LoadingState label="Loading salary history" />
          </div>
        ) : history.error ? (
          <ErrorState error={history.error} onRetry={() => void history.refetch()} />
        ) : history.data.length === 0 ? (
          <EmptyState
            title="No salary recorded"
            description="Add a salary change to start this employee's history."
          />
        ) : (
          <Table label="Salary history">
            <caption className="sr-only">Salary history, newest first</caption>
            <thead>
              <tr>
                <Th scope="col">Effective</Th>
                <Th scope="col" className="text-right">
                  Annual salary
                </Th>
                <Th scope="col">Reason</Th>
                <Th scope="col">Recorded by</Th>
                {canWrite ? (
                  <Th scope="col">
                    <span className="sr-only">Actions</span>
                  </Th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {history.data.map((record, index, all) => {
                // Newest first: anything above the current period has not taken effect yet.
                const currentIndex = all.findIndex((r) => r.isCurrent);
                const scheduled = currentIndex === -1 ? true : index < currentIndex;
                return (
                  <tr key={record.id} className={record.isCurrent ? 'bg-brand-50/60' : undefined}>
                    <Td className="whitespace-nowrap">
                      <div className="font-medium">
                        {formatDate(record.effectiveFrom)} –{' '}
                        {record.effectiveTo ? formatDate(record.effectiveTo) : 'present'}
                      </div>
                      <div className="mt-1 flex gap-1">
                        {record.isCurrent ? <Badge tone="info">Current</Badge> : null}
                        {scheduled ? <Badge tone="warning">Scheduled</Badge> : null}
                      </div>
                    </Td>
                    <Td className="tabular text-right font-medium whitespace-nowrap">
                      {formatMoney(record.amount, record.currency)}
                    </Td>
                    <Td>
                      <div>{humanize(record.reason)}</div>
                      {record.note ? (
                        <div className="text-xs text-slate-600">{record.note}</div>
                      ) : null}
                    </Td>
                    <Td className="text-slate-600">
                      {record.createdBy?.displayName ?? 'Initial data load'}
                    </Td>
                    {canWrite ? (
                      <Td className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setCorrecting(record)}>
                          <Pencil aria-hidden="true" /> Correct
                          <span className="sr-only">
                            {' '}
                            record effective {formatDate(record.effectiveFrom)}
                          </span>
                        </Button>
                      </Td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </CardContent>
      {canWrite ? (
        <SalaryChangeDialog
          employeeId={employeeId}
          current={current}
          open={adding}
          onOpenChange={setAdding}
        />
      ) : null}
      {correcting ? (
        <CorrectionDialog
          employeeId={employeeId}
          record={correcting}
          onClose={() => setCorrecting(null)}
        />
      ) : null}
    </Card>
  );
}
