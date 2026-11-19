'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { NewEmployeeForm } from '@/features/employees/new-employee-form';
import { useCurrentUser } from '@/features/shell/app-shell';

export default function NewEmployeePage() {
  const user = useCurrentUser();
  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/employees"
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft aria-hidden="true" className="size-4" /> Employees
      </Link>
      <PageHeader
        title="Add employee"
        description="Creates the employee and their starting salary together."
      />
      {user.canWrite ? (
        <NewEmployeeForm />
      ) : (
        <EmptyState title="Read-only access" description="Only HR managers can add employees." />
      )}
    </div>
  );
}
