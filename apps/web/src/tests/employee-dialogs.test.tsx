import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EmployeeDetail } from '@acme/shared';
import { EditEmployeeDialog } from '@/features/employees/employee-dialogs';
import { EmployeeDetailView } from '@/features/employees/employee-detail';
import { mockApi, renderWithProviders } from './utils';

const reference = {
  body: {
    countries: [{ code: 'IN', name: 'India', defaultCurrencyCode: 'INR' }],
    currencies: [],
    departments: [{ id: 1, name: 'Engineering' }],
    jobTitles: [{ id: 1, name: 'Software Engineer' }],
    statuses: [],
    compensationReasons: [],
  },
};

function employee(overrides: Partial<EmployeeDetail> = {}): EmployeeDetail {
  return {
    id: 'e1',
    employeeCode: 'EMP-000001',
    firstName: 'Asha',
    lastName: 'Verma',
    email: 'asha@acme.example',
    status: 'ACTIVE',
    hireDate: '2022-03-01',
    terminationDate: null,
    country: { code: 'IN', name: 'India' },
    department: { id: 1, name: 'Engineering' },
    jobTitle: { id: 1, name: 'Software Engineer' },
    currentCompensation: null,
    version: 4,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('EditEmployeeDialog', () => {
  it('sends only the changed fields with the version that was read', async () => {
    const { calls } = mockApi({
      'GET /reference-data': reference,
      'PATCH /employees/e1': { body: employee({ lastName: 'Iyer', version: 5 }) },
    });
    const onOpenChange = vi.fn();
    renderWithProviders(
      <EditEmployeeDialog employee={employee()} open onOpenChange={onOpenChange} />,
    );
    const lastName = screen.getByLabelText(/Last name/);
    await userEvent.clear(lastName);
    await userEvent.type(lastName, 'Iyer');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ version: 4, lastName: 'Iyer' });
  });

  it('can edit an inactive employee (whose status field is disabled)', async () => {
    const { calls } = mockApi({
      'GET /reference-data': reference,
      'PATCH /employees/e1': {
        body: employee({
          status: 'INACTIVE',
          terminationDate: '2026-10-31',
          email: 'new@acme.example',
          version: 5,
        }),
      },
    });
    const onOpenChange = vi.fn();
    renderWithProviders(
      <EditEmployeeDialog
        employee={employee({ status: 'INACTIVE', terminationDate: '2026-10-31' })}
        open
        onOpenChange={onOpenChange}
      />,
    );
    expect(screen.getByLabelText(/Status/)).toBeDisabled();
    const email = screen.getByLabelText(/Work email/);
    await userEvent.clear(email);
    await userEvent.type(email, 'new@acme.example');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      version: 4,
      email: 'new@acme.example',
    });
  });
});

describe('EmployeeDetailView dialogs', () => {
  it('discards cancelled edits: reopening "Edit details" shows the saved values', async () => {
    mockApi({
      'GET /employees/e1': { body: employee() },
      'GET /employees/e1/compensations': { body: { data: [] } },
      'GET /reference-data': reference,
    });
    renderWithProviders(<EmployeeDetailView id="e1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    const firstName = await screen.findByLabelText(/First name/);
    await userEvent.clear(firstName);
    await userEvent.type(firstName, 'Unsaved');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    expect(await screen.findByLabelText(/First name/)).toHaveValue('Asha');
  });
});
