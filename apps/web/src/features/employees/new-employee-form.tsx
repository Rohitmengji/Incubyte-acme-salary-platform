'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { get, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import {
  ASSIGNABLE_STATUSES,
  COMPENSATION_REASONS,
  createEmployeeRequestSchema,
} from '@acme/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { applyServerErrors } from '@/lib/form-errors';
import { humanize } from '@/lib/format';
import { useCreateEmployee, useReferenceData } from '@/lib/queries';
import { statusLabel } from './status-badge';

const FIELDS = [
  'employeeCode',
  'firstName',
  'lastName',
  'email',
  'countryCode',
  'departmentId',
  'jobTitleId',
  'hireDate',
  'status',
  'initialCompensation.amount',
  'initialCompensation.currencyCode',
  'initialCompensation.effectiveFrom',
  'initialCompensation.reason',
] as const;

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

export function NewEmployeeForm() {
  const reference = useReferenceData();
  const create = useCreateEmployee();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(createEmployeeRequestSchema),
    defaultValues: {
      employeeCode: '',
      firstName: '',
      lastName: '',
      email: '',
      countryCode: '',
      departmentId: '',
      jobTitleId: '',
      hireDate: '',
      status: 'ACTIVE',
      initialCompensation: { amount: '', currencyCode: '', reason: 'NEW_HIRE', note: '' },
    },
  });
  const {
    register,
    handleSubmit,
    setValue,
    setError,
    control,
    formState: { errors, dirtyFields },
  } = form;
  const countryCode = useWatch({ control, name: 'countryCode' });

  if (reference.isPending) return <LoadingState label="Loading form options" rows={6} />;
  if (reference.error)
    return <ErrorState error={reference.error} onRetry={() => void reference.refetch()} />;
  const { countries, departments, jobTitles, currencies } = reference.data;

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    create.mutate(values, {
      onSuccess: (employee) => {
        toast.success(`${employee.firstName} ${employee.lastName} was added.`);
        router.push(`/employees/${employee.id}`);
      },
      onError: (error) => setFormError(applyServerErrors(error, setError, FIELDS)),
    });
  });

  const errorFor = (path: (typeof FIELDS)[number]): string | undefined => {
    const node: unknown = get(errors, path);
    return node && typeof node === 'object' && 'message' in node && typeof node.message === 'string'
      ? node.message
      : undefined;
  };

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-6">
      {formError ? (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
        >
          {formError}
        </p>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Employee details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Employee ID"
            hint="As used in your HR records, e.g. EMP-010001. Cannot be changed later."
            error={errorFor('employeeCode')}
            required
          >
            {(a) => (
              <Input
                {...a}
                autoComplete="off"
                className="font-mono uppercase"
                {...register('employeeCode')}
              />
            )}
          </Field>
          <Field label="Work email" error={errorFor('email')} required>
            {(a) => <Input {...a} type="email" autoComplete="off" {...register('email')} />}
          </Field>
          <Field label="First name" error={errorFor('firstName')} required>
            {(a) => <Input {...a} autoComplete="off" {...register('firstName')} />}
          </Field>
          <Field label="Last name" error={errorFor('lastName')} required>
            {(a) => <Input {...a} autoComplete="off" {...register('lastName')} />}
          </Field>
          <Field label="Country" error={errorFor('countryCode')} required>
            {(a) => (
              <Select
                {...a}
                {...register('countryCode', {
                  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
                    // Suggest the country's currency until the user picks one themselves.
                    const country = countries.find((c) => c.code === event.target.value);
                    if (country && !dirtyFields.initialCompensation?.currencyCode) {
                      setValue('initialCompensation.currencyCode', country.defaultCurrencyCode);
                    }
                  },
                })}
              >
                <option value="">Select a country</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Hire date" error={errorFor('hireDate')} required>
            {(a) => <Input {...a} type="date" {...register('hireDate')} />}
          </Field>
          <Field label="Department" error={errorFor('departmentId')} required>
            {(a) => (
              <Select {...a} {...register('departmentId')}>
                <option value="">Select a department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Job title" error={errorFor('jobTitleId')} required>
            {(a) => (
              <Select {...a} {...register('jobTitleId')}>
                <option value="">Select a job title</option>
                {jobTitles.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Status" error={errorFor('status')}>
            {(a) => (
              <Select {...a} {...register('status')}>
                {ASSIGNABLE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Starting salary</CardTitle>
          <p className="w-full text-sm text-slate-600">
            Annual gross base salary in the employee&apos;s pay currency.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Annual salary"
            hint="Digits only, e.g. 85000 or 85000.50"
            error={errorFor('initialCompensation.amount')}
            required
          >
            {(a) => (
              <Input
                {...a}
                inputMode="decimal"
                autoComplete="off"
                className="tabular"
                {...register('initialCompensation.amount')}
              />
            )}
          </Field>
          <Field
            label="Currency"
            hint={countryCode ? undefined : 'Defaults to the country’s currency'}
            error={errorFor('initialCompensation.currencyCode')}
            required
          >
            {(a) => (
              <Select {...a} {...register('initialCompensation.currencyCode')}>
                <option value="">Select a currency</option>
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Effective from"
            hint="Leave empty to use the hire date"
            error={errorFor('initialCompensation.effectiveFrom')}
          >
            {(a) => (
              <Input
                {...a}
                type="date"
                {...register('initialCompensation.effectiveFrom', { setValueAs: emptyToUndefined })}
              />
            )}
          </Field>
          <Field label="Reason" error={errorFor('initialCompensation.reason')}>
            {(a) => (
              <Select {...a} {...register('initialCompensation.reason')}>
                {COMPENSATION_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {humanize(r)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" pending={create.isPending}>
          {create.isPending ? 'Saving…' : 'Add employee'}
        </Button>
      </div>
    </form>
  );
}
