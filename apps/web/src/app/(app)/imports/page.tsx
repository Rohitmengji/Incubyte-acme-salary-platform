'use client';

import { PageHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { ImportWorkflow } from '@/features/imports/import-workflow';
import { useCurrentUser } from '@/features/shell/app-shell';

export default function ImportsPage() {
  const user = useCurrentUser();
  return (
    <>
      <PageHeader
        title="Import & export"
        description="Bring employees in from spreadsheets, and take the data back out."
      />
      {user.canWrite ? (
        <ImportWorkflow />
      ) : (
        <EmptyState
          title="Read-only access"
          description="Only HR managers can import or export employee data."
        />
      )}
    </>
  );
}
