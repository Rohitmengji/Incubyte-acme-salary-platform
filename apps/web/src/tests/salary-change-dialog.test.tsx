import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SalaryChangeDialog } from '@/features/compensation/salary-change-dialog';
import { mockApi, problem, renderWithProviders } from './utils';

const current = { amount: '1800000.00', currency: 'INR', effectiveFrom: '2022-03-01' };
const reference = {
  body: {
    countries: [],
    currencies: [
      { code: 'INR', name: 'Indian Rupee', minorUnits: 2 },
      { code: 'USD', name: 'US Dollar', minorUnits: 2 },
    ],
    departments: [],
    jobTitles: [],
    statuses: [],
    compensationReasons: [],
  },
};

async function fill(amount: string, date = '2025-04-01') {
  await userEvent.type(screen.getByLabelText(/New annual salary/), amount);
  const dateInput = screen.getByLabelText(/Effective from/);
  await userEvent.clear(dateInput);
  await userEvent.type(dateInput, date);
  await userEvent.click(screen.getByRole('button', { name: 'Save salary change' }));
}

describe('SalaryChangeDialog', () => {
  it('rejects amounts with thousands separators before calling the API', async () => {
    const { calls } = mockApi({ 'GET /reference-data': reference });
    renderWithProviders(
      <SalaryChangeDialog employeeId="e1" current={current} open onOpenChange={() => {}} />,
    );
    await fill('2,100,000');
    expect(await screen.findByText(/no thousands separators/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('puts a server conflict on the date field (the date is already taken)', async () => {
    mockApi({
      'GET /reference-data': reference,
      'POST /employees/e1/compensations': problem(
        409,
        'A salary period already starts on 2025-04-01. Correct that record instead.',
        {
          errors: [
            {
              path: 'effectiveFrom',
              message: 'A salary period already starts on 2025-04-01. Correct that record instead.',
            },
          ],
        },
      ),
    });
    renderWithProviders(
      <SalaryChangeDialog employeeId="e1" current={current} open onOpenChange={() => {}} />,
    );
    await fill('2100000');
    const dateInput = screen.getByLabelText(/Effective from/);
    await waitFor(() => expect(dateInput).toHaveAttribute('aria-invalid', 'true'));
    expect(dateInput).toHaveAccessibleDescription(/already starts on 2025-04-01/);
  });

  it('submits once, then closes and refreshes on success', async () => {
    let resolve: () => void = () => {};
    const { calls } = mockApi({
      'GET /reference-data': reference,
      'POST /employees/e1/compensations': () =>
        new Promise((r) => {
          resolve = () =>
            r({
              status: 201,
              body: {
                id: 'c2',
                amount: '2100000.00',
                currency: 'INR',
                effectiveFrom: '2025-04-01',
              },
            });
        }),
    });
    const onOpenChange = vi.fn();
    const { queryClient } = renderWithProviders(
      <SalaryChangeDialog employeeId="e1" current={current} open onOpenChange={onOpenChange} />,
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await fill('2100000');
    const submit = screen.getByRole('button', { name: 'Saving…' });
    expect(submit).toBeDisabled(); // no double submit while pending
    resolve();

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      amount: '2100000',
      currencyCode: 'INR',
      effectiveFrom: '2025-04-01',
      reason: 'ANNUAL_REVIEW',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['employees', 'detail', 'e1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['analytics'] });
  });
});
