'use client';

import { CheckCircle2, Download, FileUp, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useId, useMemo, useState } from 'react';
import {
  CSV_COLUMNS,
  CSV_MAX_CHARS,
  CSV_MAX_ROWS,
  CSV_REQUIRED_IMPORT_COLUMNS,
  type ImportPreview,
} from '@acme/shared';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Dialog, DialogFooter } from '@/components/ui/dialog';
import { Segmented, Table, Td, Th } from '@/components/ui/table';
import { ApiError, errorMessage } from '@/lib/api';
import { formatCount, formatMoney, formatTimestamp } from '@/lib/format';
import { useCommitImport, useUploadImport } from '@/lib/queries';

const TEMPLATE = [
  CSV_COLUMNS.filter((c) => c !== 'termination_date').join(','),
  'EMP-020001,Asha,Verma,asha.verma@acme.example,IN,Engineering,Software Engineer II,ACTIVE,2026-01-12,2400000,INR,2026-01-12',
].join('\r\n');
const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`;

type Step =
  | { name: 'select' }
  | { name: 'preview'; preview: ImportPreview }
  | { name: 'done'; result: ImportPreview & { importedRows: number } };

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'danger' | 'warning';
}) {
  const color =
    tone === 'success'
      ? 'text-emerald-700'
      : tone === 'danger'
        ? 'text-red-700'
        : tone === 'warning'
          ? 'text-amber-800'
          : 'text-slate-900';
  return (
    <div className="rounded-md border border-slate-200 px-4 py-3">
      <p className="text-xs font-medium tracking-wide text-slate-600 uppercase">{label}</p>
      <p className={`tabular text-2xl font-semibold ${color}`}>{formatCount(value)}</p>
    </div>
  );
}

function PreviewPanel({
  preview,
  onReset,
  onCommitted,
}: {
  preview: ImportPreview;
  onReset: () => void;
  onCommitted: (result: ImportPreview & { importedRows: number }) => void;
}) {
  const commit = useCommitImport();
  const [confirming, setConfirming] = useState(false);
  const [filter, setFilter] = useState<'all' | 'invalid' | 'duplicate'>('all');
  const issues = preview.issues.filter((i) => filter === 'all' || i.kind === filter);
  const conflict = commit.error instanceof ApiError && commit.error.status === 409;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Preview: {preview.fileName}</CardTitle>
            <CardDescription>
              Nothing has been imported yet. This preview expires at{' '}
              {formatTimestamp(preview.expiresAt)}.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Rows in file" value={preview.totalRows} />
            <Stat label="Ready to import" value={preview.validRows} tone="success" />
            <Stat
              label="Invalid"
              value={preview.invalidRows}
              tone={preview.invalidRows ? 'danger' : undefined}
            />
            <Stat
              label="Duplicates skipped"
              value={preview.duplicateRows}
              tone={preview.duplicateRows ? 'warning' : undefined}
            />
          </div>
          {preview.previouslyImportedAt ? (
            <p
              role="status"
              className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200"
            >
              This exact file was already imported on{' '}
              {formatTimestamp(preview.previouslyImportedAt)}.
            </p>
          ) : null}
          {commit.error ? (
            <div
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
            >
              <p>{errorMessage(commit.error)}</p>
              {conflict ? (
                <Button variant="link" className="h-auto p-0" onClick={onReset}>
                  Upload the file again
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onReset} disabled={commit.isPending}>
              <RotateCcw aria-hidden="true" /> Choose another file
            </Button>
            <Button
              onClick={() => setConfirming(true)}
              disabled={preview.validRows === 0 || conflict}
            >
              Import {formatCount(preview.validRows)} employees
            </Button>
          </div>
        </CardContent>
      </Card>

      {preview.issues.length ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Rows that will be skipped</CardTitle>
              <CardDescription>
                Fix these in your spreadsheet and upload again, or import the valid rows now.
              </CardDescription>
            </div>
            <Segmented
              label="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'invalid', label: 'Invalid' },
                { value: 'duplicate', label: 'Duplicates' },
              ]}
            />
          </CardHeader>
          <CardContent className="max-h-96 overflow-auto p-0">
            <Table label="Rows that will be skipped">
              <thead>
                <tr>
                  <Th scope="col">Row</Th>
                  <Th scope="col">Column</Th>
                  <Th scope="col">Problem</Th>
                  <Th scope="col">Type</Th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue, i) => (
                  <tr key={`${issue.row}-${issue.column}-${i}`}>
                    <Td className="tabular">{issue.row}</Td>
                    <Td className="font-mono text-xs">{issue.column ?? '—'}</Td>
                    <Td>{issue.message}</Td>
                    <Td>
                      <Badge tone={issue.kind === 'invalid' ? 'danger' : 'warning'}>
                        {issue.kind === 'invalid' ? 'Invalid' : 'Duplicate'}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {preview.issuesTruncated ? (
              <p className="px-4 py-2 text-sm text-slate-600">
                …and {formatCount(preview.issuesTruncated)} more.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {preview.sample.length ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>First rows to be imported</CardTitle>
              <CardDescription>Check that columns were read correctly.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table label="First rows to be imported">
              <thead>
                <tr>
                  <Th scope="col">Row</Th>
                  <Th scope="col">Employee</Th>
                  <Th scope="col">Country</Th>
                  <Th scope="col">Department · Job title</Th>
                  <Th scope="col">Hire date</Th>
                  <Th scope="col" className="text-right">
                    Salary
                  </Th>
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((row) => (
                  <tr key={row.row}>
                    <Td className="tabular">{row.row}</Td>
                    <Td>
                      <div className="font-medium">{row.name}</div>
                      <div className="font-mono text-xs text-slate-600">{row.employeeCode}</div>
                    </Td>
                    <Td>{row.country}</Td>
                    <Td>
                      {row.department} · {row.jobTitle}
                    </Td>
                    <Td className="whitespace-nowrap">{row.hireDate}</Td>
                    <Td className="tabular text-right whitespace-nowrap">
                      {formatMoney(row.salary, row.currency)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Dialog
        open={confirming}
        // The import cannot be cancelled once sent, so keep the dialog (and its outcome) in view.
        onOpenChange={(open) => {
          if (!commit.isPending) setConfirming(open);
        }}
        title={`Import ${formatCount(preview.validRows)} employees?`}
        description="Each employee is created with their starting salary in one transaction. If anything conflicts, nothing is imported."
      >
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => setConfirming(false)}
            disabled={commit.isPending}
          >
            Cancel
          </Button>
          <Button
            pending={commit.isPending}
            onClick={() =>
              commit.mutate(preview.id, {
                onSuccess: onCommitted,
                onSettled: () => setConfirming(false),
              })
            }
          >
            {commit.isPending ? 'Importing…' : 'Import now'}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

export function ImportWorkflow() {
  const upload = useUploadImport();
  const [step, setStep] = useState<Step>({ name: 'select' });
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const inputId = useId();

  const requirements = useMemo(() => CSV_REQUIRED_IMPORT_COLUMNS.join(', '), []);

  const reset = () => {
    setStep({ name: 'select' });
    setFile(null);
    setFileError(null);
    upload.reset();
  };

  const onUpload = async () => {
    if (!file) {
      setFileError('Choose a CSV file first.');
      return;
    }
    if (!/\.csv$/i.test(file.name)) {
      setFileError('The file must be a .csv file. In Excel, use “Save as → CSV UTF-8”.');
      return;
    }
    const content = await file.text();
    if (content.length > CSV_MAX_CHARS) {
      setFileError('The file is larger than 4 MB. Split it into smaller files.');
      return;
    }
    setFileError(null);
    upload.mutate(
      { fileName: file.name, content },
      { onSuccess: (preview) => setStep({ name: 'preview', preview }) },
    );
  };

  if (step.name === 'preview') {
    return (
      <PreviewPanel
        preview={step.preview}
        onReset={reset}
        onCommitted={(result) => setStep({ name: 'done', result })}
      />
    );
  }

  if (step.name === 'done') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 aria-hidden="true" className="size-10 text-emerald-600" />
          <h2 role="status" className="text-lg font-semibold text-slate-900">
            Imported {formatCount(step.result.importedRows)} employees from {step.result.fileName}
          </h2>
          <p className="text-sm text-slate-600">
            Each import is recorded in the employees&apos; audit trails.
          </p>
          <div className="mt-2 flex gap-2">
            <Link href="/employees" className={buttonVariants()}>
              View employees
            </Link>
            <Button variant="secondary" onClick={reset}>
              Import another file
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <div>
            <CardTitle>Import employees from a spreadsheet</CardTitle>
            <CardDescription>
              Upload a CSV. You will see a preview with any problems before anything is saved.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {upload.error || fileError ? (
            <div
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
            >
              {fileError ?? errorMessage(upload.error)}
              {!fileError &&
              upload.error instanceof ApiError &&
              upload.error.problem.errors?.length ? (
                <ul className="mt-1 list-disc pl-5">
                  {upload.error.problem.errors.map((issue, i) => (
                    <li key={i}>{issue.message}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <div className="rounded-lg border-2 border-dashed border-slate-300 p-6 text-center">
            <FileUp aria-hidden="true" className="mx-auto size-8 text-slate-400" />
            <label htmlFor={inputId} className="mt-2 block text-sm font-medium text-slate-800">
              CSV file
            </label>
            <input
              id={inputId}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setFileError(null);
                upload.reset();
              }}
              className="mx-auto mt-2 block text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-800 hover:file:bg-brand-100"
            />
            <p className="mt-2 text-xs text-slate-600">
              Up to {formatCount(CSV_MAX_ROWS)} rows and 4 MB.
            </p>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void onUpload()} pending={upload.isPending} disabled={!file}>
              {upload.isPending ? 'Checking file…' : 'Upload and preview'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>File format</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <p>
              Required columns: <span className="font-mono text-xs">{requirements}</span>.
            </p>
            <p>
              Optional: <span className="font-mono text-xs">status</span> (ACTIVE or ON_LEAVE) and{' '}
              <span className="font-mono text-xs">salary_effective_from</span> (defaults to the hire
              date).
            </p>
            <p>
              Dates as YYYY-MM-DD. Salaries as plain numbers without thousands separators. Existing
              employee IDs and emails are skipped.
            </p>
            <a
              href={TEMPLATE_HREF}
              download="acme-import-template.csv"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              <Download aria-hidden="true" /> Download template
            </a>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Export</CardTitle>
              <CardDescription>
                Every employee with their current salary. Exports are recorded in the audit log.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <a
              href="/api/v1/exports/employees.csv"
              download
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              <Download aria-hidden="true" /> Export all employees
            </a>
            <p className="mt-2 text-xs text-slate-600">
              To export a filtered list, use Export CSV on the Employees page.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
