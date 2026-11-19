'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
  COMPENSATION_REASONS,
  createCompensationRequestSchema,
  utcToday,
  type CurrentCompensation,
} from '@acme/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { applyServerErrors } from '@/lib/form-errors';
import { formatMoney, humanize } from '@/lib/format';
import { useAddCompensation, useReferenceData } from '@/lib/queries';

const FIELDS = ['amount', 'currencyCode', 'effectiveFrom', 'reason', 'note'] as const;

export function SalaryChangeDialog({
  employeeId,
  current,
  open,
  onOpenChange,
}: {
  employeeId: string;
  current: CurrentCompensation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const reference = useReferenceData();
  const add = useAddCompensation(employeeId);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(createCompensationRequestSchema),
    defaultValues: {
      amount: '',
      currencyCode: current?.currency ?? 'USD',
      effectiveFrom: utcToday(new Date()),
      reason: 'ANNUAL_REVIEW',
      note: '',
    },
  });

  const close = (next: boolean) => {
    if (!next) {
      reset();
      setFormError(null);
    }
    onOpenChange(next);
  };

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    add.mutate(
      { ...values, note: values.note || undefined },
      {
        onSuccess: (record) => {
          toast.success(
            `Salary change to ${formatMoney(record.amount, record.currency)} effective ${record.effectiveFrom} saved.`,
          );
          close(false);
        },
        onError: (error) => setFormError(applyServerErrors(error, setError, FIELDS)),
      },
    );
  });

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Add salary change"
      description={
        current
          ? `Current salary: ${formatMoney(current.amount, current.currency)} since ${current.effectiveFrom}. A future date schedules the change.`
          : 'A future date schedules the change.'
      }
    >
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
        {formError ? (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
          >
            {formError}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="New annual salary"
            hint="e.g. 92000 or 92000.50"
            error={errors.amount?.message}
            required
          >
            {(a) => (
              <Input
                {...a}
                inputMode="decimal"
                autoComplete="off"
                className="tabular"
                {...register('amount')}
              />
            )}
          </Field>
          <Field label="Currency" error={errors.currencyCode?.message} required>
            {(a) => (
              <Select {...a} {...register('currencyCode')}>
                {(
                  reference.data?.currencies ?? [{ code: current?.currency ?? 'USD', name: '' }]
                ).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Effective from" error={errors.effectiveFrom?.message} required>
            {(a) => <Input {...a} type="date" {...register('effectiveFrom')} />}
          </Field>
          <Field label="Reason" error={errors.reason?.message} required>
            {(a) => (
              <Select {...a} {...register('reason')}>
                {COMPENSATION_REASONS.filter((r) => r !== 'NEW_HIRE').map((r) => (
                  <option key={r} value={r}>
                    {humanize(r)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field
          label="Note"
          hint="Optional context, e.g. the review cycle"
          error={errors.note?.message}
        >
          {(a) => <Textarea {...a} rows={2} {...register('note')} />}
        </Field>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="submit" pending={add.isPending}>
            {add.isPending ? 'Saving…' : 'Save salary change'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
