import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { EmployeeSummary, Paginated, ReferenceData } from '@acme/shared';
import { EmployeesView } from '@/features/employees/employees-view';
import { currentUrl, router, setUrl } from './navigation-mock';
import { mockApi, problem, renderWithProviders, VIEWER } from './utils';

const reference: ReferenceData = {
  countries: [
    { code: 'IN', name: 'India', defaultCurrencyCode: 'INR' },
    { code: 'JP', name: 'Japan', defaultCurrencyCode: 'JPY' },
  ],
  currencies: [{ code: 'INR', name: 'Indian Rupee', minorUnits: 2 }],
  departments: [{ id: 1, name: 'Engineering' }],
  jobTitles: [{ id: 1, name: 'Software Engineer' }],
  statuses: ['ACTIVE', 'ON_LEAVE', 'INACTIVE'],
  compensationReasons: ['NEW_HIRE'],
};

function employee(n: number, overrides: Partial<EmployeeSummary> = {}): EmployeeSummary {
  return {
    id: `id-${n}`,
    employeeCode: `EMP-00000${n}`,
    firstName: 'Priya',
    lastName: `Sharma${n}`,
    email: `p${n}@acme.example`,
    status: 'ACTIVE',
    hireDate: '2022-03-01',
    terminationDate: null,
    country: { code: 'IN', name: 'India' },
    department: { id: 1, name: 'Engineering' },
    jobTitle: { id: 1, name: 'Software Engineer' },
    currentCompensation: { amount: '1800000.00', currency: 'INR', effectiveFrom: '2022-03-01' },
    ...overrides,
  };
}

const page = (data: EmployeeSummary[], total = data.length): Paginated<EmployeeSummary> => ({
  data,
  page: 1,
  pageSize: 25,
  total,
  totalPages: Math.ceil(total / 25),
});

describe('EmployeesView', () => {
  it('renders the server page with exact salaries and a result summary', async () => {
    mockApi({
      'GET /employees': { body: page([employee(1), employee(2, { status: 'ON_LEAVE' })], 120) },
      'GET /reference-data': { body: reference },
    });
    setUrl('/employees');
    renderWithProviders(<EmployeesView />);

    expect(await screen.findByRole('link', { name: 'Priya Sharma1' })).toHaveAttribute(
      'href',
      '/employees/id-1',
    );
    expect(screen.getAllByText('INR 1,800,000.00')).toHaveLength(2);
    expect(screen.getByText('On leave', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1–25 of 120');
  });

  it('debounces search, writes it to the URL and sends it to the API', async () => {
    const { calls } = mockApi({
      'GET /employees': ({ url }) => ({
        body: page(url.searchParams.get('search') ? [employee(7)] : [employee(1), employee(2)]),
      }),
      'GET /reference-data': { body: reference },
    });
    setUrl('/employees');
    renderWithProviders(<EmployeesView />);
    await screen.findByText('Priya Sharma1');

    await userEvent.type(screen.getByLabelText('Search by name or employee ID'), 'EMP-000007');
    await waitFor(() => expect(currentUrl().searchParams.get('search')).toBe('EMP-000007'));
    expect(await screen.findByText('Priya Sharma7')).toBeInTheDocument();
    // Debounced: one request for the initial list, one for the final term - not one per keystroke.
    const searches = calls.filter((c) => c.url.pathname.endsWith('/employees'));
    expect(searches.map((c) => c.url.searchParams.get('search'))).toEqual([null, 'EMP-000007']);
  });

  it('adds a history entry for filter changes but not for each typed search', async () => {
    mockApi({
      'GET /employees': { body: page([employee(1)]) },
      'GET /reference-data': { body: reference },
    });
    setUrl('/employees');
    renderWithProviders(<EmployeesView />);
    await screen.findByText('Priya Sharma1');
    await userEvent.selectOptions(screen.getByLabelText('Countries'), 'JP');
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith('/employees?country=JP', expect.anything()),
    );
    await userEvent.type(screen.getByLabelText('Search by name or employee ID'), 'asha');
    await waitFor(() => expect(currentUrl().searchParams.get('search')).toBe('asha'));
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace.mock.calls[0]![0]).toMatch(/search=asha/);
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it('"Clear filters" also cancels a search that was typed but not yet sent', async () => {
    mockApi({
      'GET /employees': { body: page([employee(1)]) },
      'GET /reference-data': { body: reference },
    });
    setUrl('/employees?country=JP');
    renderWithProviders(<EmployeesView />);
    await screen.findByText('Priya Sharma1');
    await userEvent.type(screen.getByLabelText('Search by name or employee ID'), 'asha');
    await userEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    // Wait past the 300 ms debounce: the cleared search must not come back.
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(currentUrl().search).toBe('');
    expect(screen.getByLabelText('Search by name or employee ID')).toHaveValue('');
  });

  it('sorts on the server when a column header is clicked and exposes aria-sort', async () => {
    mockApi({
      'GET /employees': { body: page([employee(1)]) },
      'GET /reference-data': { body: reference },
    });
    setUrl('/employees');
    renderWithProviders(<EmployeesView />);
    await screen.findByText('Priya Sharma1');

    await userEvent.click(screen.getByRole('button', { name: /Hire date/ }));
    await waitFor(() => expect(currentUrl().searchParams.get('sort')).toBe('hireDate'));
    expect(screen.getByRole('columnheader', { name: /Hire date/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await userEvent.click(screen.getByRole('button', { name: /Hire date/ }));
    await waitFor(() => expect(currentUrl().searchParams.get('order')).toBe('desc'));
    // The salary column is deliberately not sortable across currencies.
    expect(
      within(screen.getByRole('columnheader', { name: 'Current salary' })).queryByRole('button'),
    ).toBeNull();
  });

  it('filters by country and resets to page 1', async () => {
    mockApi({
      'GET /employees': { body: page([employee(1)]) },
      'GET /reference-data': { body: reference },
    });
    setUrl('/employees?page=4');
    renderWithProviders(<EmployeesView />);
    await screen.findByText('Priya Sharma1');
    await userEvent.selectOptions(screen.getByLabelText('Countries'), 'JP');
    await waitFor(() => expect(currentUrl().search).toBe('?country=JP'));
  });

  it('handles a page number past the end (stale bookmark) instead of showing nonsense ranges', async () => {
    mockApi({
      'GET /employees': ({ url }) => ({
        body: {
          data: url.searchParams.get('page') === '9' ? [] : [employee(1)],
          page: Number(url.searchParams.get('page') ?? 1),
          pageSize: 25,
          total: 120,
          totalPages: 5,
        },
      }),
      'GET /reference-data': { body: reference },
    });
    setUrl('/employees?page=9');
    renderWithProviders(<EmployeesView />);
    expect(await screen.findByText('This page is past the end of the results')).toBeInTheDocument();
    expect(screen.queryByText(/Showing 201/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Go to the last page' }));
    await waitFor(() => expect(currentUrl().searchParams.get('page')).toBe('5'));
  });

  it('shows an empty state with a way out when nothing matches', async () => {
    mockApi({ 'GET /employees': { body: page([]) }, 'GET /reference-data': { body: reference } });
    setUrl('/employees?search=zzz');
    renderWithProviders(<EmployeesView />);
    expect(await screen.findByText('No employees match')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    await waitFor(() => expect(currentUrl().search).toBe(''));
  });

  it('shows an error with retry when the API fails', async () => {
    let attempts = 0;
    mockApi({
      'GET /employees': () =>
        ++attempts === 1 ? problem(500, 'Database unavailable') : { body: page([employee(1)]) },
      'GET /reference-data': { body: reference },
    });
    setUrl('/employees');
    renderWithProviders(<EmployeesView />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Priya Sharma1')).toBeInTheDocument();
  });

  it('hides write actions from read-only viewers', async () => {
    mockApi({
      'GET /employees': { body: page([employee(1)]) },
      'GET /reference-data': { body: reference },
    });
    setUrl('/employees');
    renderWithProviders(<EmployeesView />, { user: VIEWER });
    await screen.findByText('Priya Sharma1');
    expect(screen.queryByRole('link', { name: /Add employee/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Export CSV/ })).toBeNull();
  });
});
