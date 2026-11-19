'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  ASSIGNABLE_STATUSES,
  countryCodeSchema,
  isoDateSchema,
  utcToday,
  type EmployeeDetail,
  type UpdateEmployeeRequest,
} from '@acme/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { applyServerErrors } from '@/lib/form-errors';
import {
  useDeactivateEmployee,
  useReactivateEmployee,
  useReferenceData,
  useUpdateEmployee,
} from '@/lib/queries';
import { statusLabel } from './status-badge';

function FormAlert({ message }: { message: string | null }) {
  return message ? (
    <p
      role="alert"
      className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
    >
      {message}
    </p>
  ) : null;
}

const editSchema = z.object({
  firstName: z.string().trim().min(1, 'Required').max(100),
  lastName: z.string().trim().min(1, 'Required').max(100),
  email: z.string().trim().toLowerCase().pipe(z.email('Must be a valid email address')),
  countryCode: countryCodeSchema,
  departmentId: z.coerce.number().int().positive('Required'),
  jobTitleId: z.coerce.number().int().positive('Required'),
  hireDate: isoDateSchema,
  status: z.enum([...ASSIGNABLE_STATUSES, 'INACTIVE']),
});
const EDIT_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'countryCode',
  'departmentId',
  'jobTitleId',
  'hireDate',
  'status',
] as const;

export function EditEmployeeDialog({
  employee,
  open,
  onOpenChange,
}: {
  employee: EmployeeDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const reference = useReferenceData();
  const update = useUpdateEmployee(employee.id);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(editSchema),
    values: {
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      countryCode: employee.country.code,
      departmentId: employee.department.id,
      jobTitleId: employee.jobTitle.id,
      hireDate: employee.hireDate,
      status: employee.status,
    },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    // Send only changed fields with the version that was read (optimistic concurrency).
    const body: UpdateEmployeeRequest = { version: employee.version };
    if (values.firstName !== employee.firstName) body.firstName = values.firstName;
    if (values.lastName !== employee.lastName) body.lastName = values.lastName;
    if (values.email !== employee.email) body.email = values.email;
    if (values.countryCode !== employee.country.code) body.countryCode = values.countryCode;
    if (values.departmentId !== employee.department.id) body.departmentId = values.departmentId;
    if (values.jobTitleId !== employee.jobTitle.id) body.jobTitleId = values.jobTitleId;
    if (values.hireDate !== employee.hireDate) body.hireDate = values.hireDate;
    if (values.status !== employee.status && values.status !== 'INACTIVE')
      body.status = values.status;
    if (Object.keys(body).length === 1) {
      onOpenChange(false);
      return;
    }
    update.mutate(body, {
      onSuccess: () => {
        toast.success('Employee details updated.');
        onOpenChange(false);
      },
      onError: (error) => setFormError(applyServerErrors(error, setError, EDIT_FIELDS)),
    });
  });

  const inactive = employee.status === 'INACTIVE';
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit employee"
      description={`Employee ID ${employee.employeeCode} cannot be changed.`}
    >
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
        <FormAlert message={formError} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" error={errors.firstName?.message} required>
            {(a) => <Input {...a} {...register('firstName')} />}
          </Field>
          <Field label="Last name" error={errors.lastName?.message} required>
            {(a) => <Input {...a} {...register('lastName')} />}
          </Field>
          <Field
            label="Work email"
            error={errors.email?.message}
            required
            className="sm:col-span-2"
          >
            {(a) => <Input {...a} type="email" {...register('email')} />}
          </Field>
          <Field label="Country" error={errors.countryCode?.message} required>
            {(a) => (
              <Select {...a} {...register('countryCode')}>
                {(reference.data?.countries ?? [employee.country]).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Hire date" error={errors.hireDate?.message} required>
            {(a) => <Input {...a} type="date" {...register('hireDate')} />}
          </Field>
          <Field label="Department" error={errors.departmentId?.message} required>
            {(a) => (
              <Select {...a} {...register('departmentId')}>
                {(reference.data?.departments ?? [employee.department]).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Job title" error={errors.jobTitleId?.message} required>
            {(a) => (
              <Select {...a} {...register('jobTitleId')}>
                {(reference.data?.jobTitles ?? [employee.jobTitle]).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Status"
            hint={inactive ? 'Reactivate the employee to change status' : undefined}
            error={errors.status?.message}
          >
            {(a) => (
              <Select {...a} disabled={inactive} {...register('status')}>
                {(inactive ? (['INACTIVE'] as const) : ASSIGNABLE_STATUSES).map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" pending={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

const deactivateSchema = z.object({
  terminationDate: isoDateSchema,
  reason: z.string().trim().min(3, 'Please give a short reason').max(500),
});

export function DeactivateDialog({
  employee,
  open,
  onOpenChange,
}: {
  employee: EmployeeDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const deactivate = useDeactivateEmployee(employee.id);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(deactivateSchema),
    defaultValues: { terminationDate: utcToday(new Date()), reason: '' },
  });

  const onSubmit = handleSubmit((values) =>
    deactivate.mutate(
      { version: employee.version, ...values },
      {
        onSuccess: () => {
          toast.success(`${employee.firstName} ${employee.lastName} was deactivated.`);
          onOpenChange(false);
        },
        onError: (error) =>
          setFormError(applyServerErrors(error, setError, ['terminationDate', 'reason'])),
      },
    ),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Deactivate ${employee.firstName} ${employee.lastName}?`}
      description="Their record and salary history are kept. Inactive employees are excluded from headcount and pay analytics after the termination date."
    >
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
        <FormAlert message={formError} />
        <Field
          label="Termination date"
          hint="Last day of employment"
          error={errors.terminationDate?.message}
          required
        >
          {(a) => <Input {...a} type="date" {...register('terminationDate')} />}
        </Field>
        <Field label="Reason" error={errors.reason?.message} required>
          {(a) => <Textarea {...a} rows={2} {...register('reason')} />}
        </Field>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" pending={deactivate.isPending}>
            {deactivate.isPending ? 'Deactivating…' : 'Deactivate employee'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

const reactivateSchema = z.object({
  reason: z.string().trim().min(3, 'Please give a short reason').max(500),
});

export function ReactivateDialog({
  employee,
  open,
  onOpenChange,
}: {
  employee: EmployeeDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const reactivate = useReactivateEmployee(employee.id);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(reactivateSchema), defaultValues: { reason: '' } });

  const onSubmit = handleSubmit((values) =>
    reactivate.mutate(
      { version: employee.version, ...values },
      {
        onSuccess: () => {
          toast.success(`${employee.firstName} ${employee.lastName} is active again.`);
          onOpenChange(false);
        },
        onError: (error) => setFormError(applyServerErrors(error, setError, ['reason'])),
      },
    ),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Undo deactivation?"
      description="Use this only to correct a mistaken deactivation. It clears the termination date. Rehiring someone is not supported."
    >
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
        <FormAlert message={formError} />
        <Field label="Reason" error={errors.reason?.message} required>
          {(a) => <Textarea {...a} rows={2} {...register('reason')} />}
        </Field>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" pending={reactivate.isPending}>
            {reactivate.isPending ? 'Saving…' : 'Reactivate employee'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
