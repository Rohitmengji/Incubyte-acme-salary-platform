'use client';

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Search,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  EMPLOYEE_STATUSES,
  PAGE_SIZES,
  type EmployeeSortField,
  type EmployeeSummary,
} from '@acme/shared';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { toQueryString } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatCount, formatDate, formatMoney } from '@/lib/format';
import { useEmployees, useReferenceData } from '@/lib/queries';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useCurrentUser } from '@/features/shell/app-shell';
import { StatusBadge, statusLabel } from './status-badge';
import { useEmployeeQueryState } from './use-employee-query';

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData, TValue> {
    sort?: EmployeeSortField;
    align?: 'right';
    className?: string;
    /** Phantom use of the generics required by the interface signature. */
    _types?: [TData, TValue];
  }
}

const columns: ColumnDef<EmployeeSummary>[] = [
  {
    id: 'name',
    header: 'Employee',
    meta: { sort: 'name', className: 'sticky left-0 z-10 bg-white min-w-52' },
    cell: ({ row }) => (
      <div>
        <Link
          href={`/employees/${row.original.id}`}
          className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
        >
          {row.original.firstName} {row.original.lastName}
        </Link>
        <div className="font-mono text-xs text-slate-600">{row.original.employeeCode}</div>
      </div>
    ),
  },
  {
    id: 'country',
    header: 'Country',
    meta: { sort: 'country' },
    cell: ({ row }) => row.original.country.name,
  },
  {
    id: 'department',
    header: 'Department',
    meta: { sort: 'department' },
    cell: ({ row }) => row.original.department.name,
  },
  {
    id: 'jobTitle',
    header: 'Job title',
    meta: { sort: 'jobTitle', className: 'min-w-44' },
    cell: ({ row }) => row.original.jobTitle.name,
  },
  {
    id: 'status',
    header: 'Status',
    meta: { sort: 'status' },
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    id: 'hireDate',
    header: 'Hire date',
    meta: { sort: 'hireDate', className: 'whitespace-nowrap' },
    cell: ({ row }) => formatDate(row.original.hireDate),
  },
  {
    id: 'salary',
    header: 'Current salary',
    meta: { align: 'right', className: 'whitespace-nowrap' },
    cell: ({ row }) =>
      row.original.currentCompensation ? (
        <span className="tabular">
          {formatMoney(
            row.original.currentCompensation.amount,
            row.original.currentCompensation.currency,
          )}
        </span>
      ) : (
        <span className="text-slate-500">—</span>
      ),
  },
];

function SearchBox({ value, onSearch }: { value: string; onSearch: (value: string) => void }) {
  const [text, setText] = useState(value);
  const debounced = useDebouncedValue(text, 300);
  const lastSent = useRef(value);

  useEffect(() => {
    // Only send what the user settled on: right after an external reset (e.g. "Clear filters") the
    // box is already empty but `debounced` still holds the old term for up to 300 ms, and sending
    // it would bring the cleared search back.
    if (debounced === text && debounced.trim() !== lastSent.current) {
      lastSent.current = debounced.trim();
      onSearch(debounced.trim());
    }
  }, [debounced, text, onSearch]);

  // Follow external URL changes (e.g. "Clear filters") without fighting the user's typing.
  useEffect(() => {
    if (value !== lastSent.current) {
      lastSent.current = value;
      setText(value);
    }
  }, [value]);

  return (
    <div className="relative w-full sm:max-w-xs">
      <label htmlFor="employee-search" className="sr-only">
        Search by name or employee ID
      </label>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500"
      />
      <Input
        id="employee-search"
        type="search"
        placeholder="Search name or employee ID"
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="pl-9"
        autoComplete="off"
      />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="sr-only" htmlFor={`filter-${label}`}>
        {label}
      </label>
      <Select
        id={`filter-${label}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full sm:w-44"
      >
        <option value="">All {label.toLowerCase()}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function EmployeesView() {
  const { query, update, reset: resetQuery, hasFilters } = useEmployeeQueryState();
  // Remounting the search box on reset also cancels a debounced search that has not been sent yet,
  // which would otherwise re-apply itself after "Clear filters".
  const [searchKey, setSearchKey] = useState(0);
  const reset = () => {
    setSearchKey((k) => k + 1);
    resetQuery();
  };
  const employees = useEmployees(query);
  const reference = useReferenceData();
  const user = useCurrentUser();

  // eslint-disable-next-line react-hooks/incompatible-library -- the app does not use the React Compiler
  const table = useReactTable({
    data: employees.data?.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    rowCount: employees.data?.total ?? 0,
  });

  const toggleSort = (field: EmployeeSortField) =>
    update({ sort: field, order: query.sort === field && query.order === 'asc' ? 'desc' : 'asc' });

  const { page: _page, pageSize: _pageSize, ...exportQuery } = query;
  const exportHref = `/api/v1/exports/employees.csv${toQueryString(exportQuery)}`;
  const data = employees.data;
  const first = data && data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const last = data ? Math.min(data.page * data.pageSize, data.total) : 0;

  return (
    <>
      <PageHeader
        title="Employees"
        description="Search, filter and open any employee to manage their salary."
        actions={
          user.canWrite ? (
            <>
              <a href={exportHref} download className={buttonVariants({ variant: 'secondary' })}>
                <Download aria-hidden="true" /> Export CSV
              </a>
              <Link href="/employees/new" className={buttonVariants()}>
                <Plus aria-hidden="true" /> Add employee
              </Link>
            </>
          ) : null
        }
      />

      <Card>
        <div
          role="search"
          className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center"
        >
          <SearchBox
            key={searchKey}
            value={query.search ?? ''}
            onSearch={(search) => update({ search: search || undefined }, { history: 'replace' })}
          />
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <FilterSelect
              label="Countries"
              value={query.country?.[0] ?? ''}
              onChange={(v) => update({ country: v ? [v] : undefined })}
              options={(reference.data?.countries ?? []).map((c) => ({
                value: c.code,
                label: c.name,
              }))}
            />
            <FilterSelect
              label="Departments"
              value={String(query.department?.[0] ?? '')}
              onChange={(v) => update({ department: v ? [Number(v)] : undefined })}
              options={(reference.data?.departments ?? []).map((d) => ({
                value: String(d.id),
                label: d.name,
              }))}
            />
            <FilterSelect
              label="Job titles"
              value={String(query.jobTitle?.[0] ?? '')}
              onChange={(v) => update({ jobTitle: v ? [Number(v)] : undefined })}
              options={(reference.data?.jobTitles ?? []).map((t) => ({
                value: String(t.id),
                label: t.name,
              }))}
            />
            <FilterSelect
              label="Statuses"
              value={query.status?.[0] ?? ''}
              onChange={(v) => update({ status: v ? [v as EmployeeSummary['status']] : undefined })}
              options={EMPLOYEE_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
            />
          </div>
          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={reset} className="self-start lg:self-auto">
              <X aria-hidden="true" /> Clear filters
            </Button>
          ) : null}
        </div>

        <p aria-live="polite" className="sr-only">
          {employees.isFetching
            ? 'Loading employees'
            : data
              ? `${formatCount(data.total)} employees found`
              : ''}
        </p>

        {employees.isPending ? (
          <div className="p-4">
            <LoadingState label="Loading employees" rows={8} />
          </div>
        ) : employees.error ? (
          <ErrorState error={employees.error} onRetry={() => void employees.refetch()} />
        ) : data && data.total > 0 && data.data.length === 0 ? (
          <EmptyState
            title="This page is past the end of the results"
            description={`There are ${formatCount(data.total)} matching employees on ${formatCount(data.totalPages)} pages.`}
            action={
              <Button variant="secondary" onClick={() => update({ page: data.totalPages })}>
                Go to the last page
              </Button>
            }
          />
        ) : data && data.total === 0 ? (
          <EmptyState
            title="No employees match"
            description="Try a different name or employee ID, or remove some filters."
            action={
              hasFilters ? (
                <Button variant="secondary" onClick={reset}>
                  Clear filters
                </Button>
              ) : null
            }
          />
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-label="Employees table"
            className={cn(
              'relative overflow-x-auto transition-opacity',
              employees.isPlaceholderData && 'opacity-60',
            )}
          >
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">
                Employees, sorted by {query.sort}{' '}
                {query.order === 'asc' ? 'ascending' : 'descending'}. Salaries are shown in each
                employee&apos;s pay currency and are not sortable across currencies.
              </caption>
              <thead>
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => {
                      const meta = header.column.columnDef.meta;
                      const sortField = meta?.sort;
                      const active = sortField && query.sort === sortField;
                      return (
                        <th
                          key={header.id}
                          scope="col"
                          aria-sort={
                            active
                              ? query.order === 'asc'
                                ? 'ascending'
                                : 'descending'
                              : sortField
                                ? 'none'
                                : undefined
                          }
                          className={cn(
                            'border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold tracking-wide text-slate-600 uppercase',
                            meta?.align === 'right' && 'text-right',
                            meta?.className,
                            meta?.className?.includes('sticky') && 'bg-slate-50',
                          )}
                        >
                          {sortField ? (
                            <button
                              type="button"
                              onClick={() => toggleSort(sortField)}
                              className="inline-flex items-center gap-1 rounded uppercase hover:text-slate-900"
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {active ? (
                                query.order === 'asc' ? (
                                  <ArrowUp aria-hidden="true" className="size-3.5" />
                                ) : (
                                  <ArrowDown aria-hidden="true" className="size-3.5" />
                                )
                              ) : (
                                <ArrowUpDown
                                  aria-hidden="true"
                                  className="size-3.5 text-slate-400"
                                />
                              )}
                            </button>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta;
                      return (
                        <td
                          key={cell.id}
                          className={cn(
                            'border-b border-slate-100 px-3 py-2.5 text-slate-800',
                            meta?.align === 'right' && 'text-right',
                            meta?.className,
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.data.length > 0 ? (
          <nav
            aria-label="Pagination"
            className="flex flex-col gap-3 p-4 text-sm text-slate-700 sm:flex-row sm:items-center sm:justify-between"
          >
            <p>
              Showing <span className="font-medium">{formatCount(first)}</span>–
              <span className="font-medium">{formatCount(last)}</span> of{' '}
              <span className="font-medium">{formatCount(data.total)}</span>
            </p>
            <div className="flex items-center gap-2">
              <label htmlFor="page-size" className="text-slate-600">
                Rows per page
              </label>
              <Select
                id="page-size"
                value={query.pageSize}
                onChange={(e) => update({ pageSize: Number(e.target.value) })}
                className="h-8 w-20"
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </Select>
              <Button
                variant="secondary"
                size="sm"
                disabled={data.page <= 1}
                onClick={() => update({ page: data.page - 1 })}
                aria-label="Previous page"
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <span className="tabular whitespace-nowrap">
                Page {formatCount(data.page)} of {formatCount(Math.max(1, data.totalPages))}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={data.page >= data.totalPages}
                onClick={() => update({ page: data.page + 1 })}
                aria-label="Next page"
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </nav>
        ) : null}
      </Card>
    </>
  );
}
