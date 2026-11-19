'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  COMPENSATION_REASONS,
  amountSchema,
  currencyCodeSchema,
  isoDateSchema,
  type CompensationRecord,
  type CorrectCompensationRequest,
} from '@acme/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { ApiError } from '@/lib/api';
import { applyServerErrors } from '@/lib/form-errors';
import { humanize } from '@/lib/format';
import { useCorrectCompensation, useReferenceData } from '@/lib/queries';

const schema = z.object({
  amount: amountSchema,
  currencyCode: currencyCodeSchema,
  effectiveFrom: isoDateSchema,
  reason: z.enum(COMPENSATION_REASONS),
  note: z.string().trim().max(500),
  correctionReason: z.string().trim().min(3, 'Explain why this record is being corrected').max(500),
});

const FIELDS = [
  'amount',
  'currencyCode',
  'effectiveFrom',
  'reason',
  'note',
  'correctionReason',
] as const;

/** Only the fields that actually changed are sent, together with the version that was read. */
export function buildCorrection(
  record: CompensationRecord,
  values: z.output<typeof schema>,
): CorrectCompensationRequest | null {
  const body: CorrectCompensationRequest = {
    version: record.version,
    correctionReason: values.correctionReason,
  };
  if (values.amount !== record.amount) body.amount = values.amount;
  if (values.currencyCode !== record.currency) body.currencyCode = values.currencyCode;
  if (values.effectiveFrom !== record.effectiveFrom) body.effectiveFrom = values.effectiveFrom;
  if (values.reason !== record.reason) body.reason = values.reason;
  if (values.note !== (record.note ?? '')) body.note = values.note || null;
  return Object.keys(body).length > 2 ? body : null;
}

export function CorrectionDialog({
  employeeId,
  record,
  onClose,
}: {
  employeeId: string;
  record: CompensationRecord;
  onClose: () => void;
}) {
  const reference = useReferenceData();
  const correct = useCorrectCompensation(employeeId);
  const [formError, setFormError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: record.amount,
      currencyCode: record.currency,
      effectiveFrom: record.effectiveFrom,
      reason: record.reason,
      note: record.note ?? '',
      correctionReason: '',
    },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    const body = buildCorrection(record, values);
    if (!body) {
      setFormError('Nothing has changed. Edit at least one field, or cancel.');
      return;
    }
    correct.mutate(
      { id: record.id, ...body },
      {
        onSuccess: () => {
          toast.success('Salary record corrected. The change is in the audit trail.');
          onClose();
        },
        onError: (error) => {
          setStale(error instanceof ApiError && error.isStaleVersion);
          setFormError(applyServerErrors(error, setError, FIELDS));
        },
      },
    );
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Correct salary record"
      description="Use this to fix a mistake. To record a raise, add a salary change instead. Corrections are audited."
    >
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
        {formError ? (
          <div
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
          >
            <p>{formError}</p>
            {stale ? (
              <Button type="button" variant="link" className="h-auto p-0" onClick={onClose}>
                Close and reload the latest history
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Annual salary" error={errors.amount?.message} required>
            {(a) => (
              <Input {...a} inputMode="decimal" className="tabular" {...register('amount')} />
            )}
          </Field>
          <Field label="Currency" error={errors.currencyCode?.message} required>
            {(a) => (
              <Select {...a} {...register('currencyCode')}>
                {(reference.data?.currencies ?? [{ code: record.currency }]).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Effective from"
            hint="Can only move between the neighbouring records"
            error={errors.effectiveFrom?.message}
            required
          >
            {(a) => <Input {...a} type="date" {...register('effectiveFrom')} />}
          </Field>
          <Field label="Reason" error={errors.reason?.message} required>
            {(a) => (
              <Select {...a} {...register('reason')}>
                {COMPENSATION_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {humanize(r)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Note" error={errors.note?.message}>
          {(a) => <Textarea {...a} rows={2} {...register('note')} />}
        </Field>
        <Field
          label="Why is this being corrected?"
          error={errors.correctionReason?.message}
          required
        >
          {(a) => <Textarea {...a} rows={2} {...register('correctionReason')} />}
        </Field>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" pending={correct.isPending}>
            {correct.isPending ? 'Saving…' : 'Save correction'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
