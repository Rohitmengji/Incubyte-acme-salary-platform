import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AnalyticsSummary } from '@acme/shared';
import { DashboardView } from '@/features/dashboard/dashboard-view';
import { mockApi, problem, renderWithProviders } from './utils';

const stats = (currency: string, n: number, median: string) => ({
  currency,
  n,
  min: median,
  max: median,
  avg: median,
  median,
  p25: median,
  p75: median,
  total: median,
  smallSample: n < 5,
});

const summary: AnalyticsSummary = {
  asOf: '2026-11-19',
  records: { total: 10000, byStatus: { ACTIVE: 8797, ON_LEAVE: 409, INACTIVE: 794 } },
  employedHeadcount: 9206,
  headcountByCountry: [{ code: 'US', name: 'United States', count: 2742 }],
  payByCurrency: [stats('USD', 2930, '108500.00'), stats('JPY', 3, '8000000')],
  normalized: { ...stats('USD', 9206, '72340.00'), avg: '75198.05' },
  fx: { asOfDate: '2026-10-31', source: 'Illustrative', reportingCurrency: 'USD' },
  missingFxRates: 0,
};

const charts = {
  'GET /analytics/distribution': {
    body: {
      asOf: '2026-11-19',
      dimension: 'department',
      currencyMode: 'normalized',
      fx: summary.fx,
      rows: [],
    },
  },
  'GET /analytics/histogram': {
    body: { asOf: '2026-11-19', currency: 'USD', normalized: true, fx: summary.fx, buckets: [] },
  },
  'GET /analytics/recent-changes': { body: { data: [] } },
};

describe('DashboardView', () => {
  it('shows a loading state, then KPIs with the currency context spelled out', async () => {
    mockApi({ 'GET /analytics/summary': { body: summary }, ...charts });
    renderWithProviders(<DashboardView />);
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);

    expect(await screen.findByText('10,000')).toBeInTheDocument();
    expect(screen.getByText('8,797 active · 409 on leave · 794 inactive')).toBeInTheDocument();
    expect(screen.getByText('USD 72,340.00')).toBeInTheDocument();
    expect(
      screen.getAllByText(/USD at the 31 Oct 2026 FX snapshot \(illustrative rates\)/).length,
    ).toBeGreaterThan(0);
    // Per-currency rows are never summed; small groups are flagged.
    expect(screen.getByRole('rowheader', { name: /JPY/ })).toHaveTextContent('Small sample');
    // Median and average cells, formatted with JPY's zero decimals.
    expect(screen.getAllByText('JPY 8,000,000', { selector: 'td' })).toHaveLength(2);
  });

  it('shows an empty state for recent changes when none exist', async () => {
    mockApi({ 'GET /analytics/summary': { body: summary }, ...charts });
    renderWithProviders(<DashboardView />);
    expect(await screen.findByText('No salary changes yet')).toBeInTheDocument();
  });

  it('shows an error with retry when the summary fails', async () => {
    let attempts = 0;
    mockApi({
      'GET /analytics/summary': () =>
        ++attempts === 1 ? problem(503, 'Service unavailable') : { body: summary },
      ...charts,
    });
    renderWithProviders(<DashboardView />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('10,000')).toBeInTheDocument();
  });

  it('guides the user when there are no employees at all', async () => {
    mockApi({
      'GET /analytics/summary': {
        body: {
          ...summary,
          records: { total: 0, byStatus: { ACTIVE: 0, ON_LEAVE: 0, INACTIVE: 0 } },
          employedHeadcount: 0,
          headcountByCountry: [],
          payByCurrency: [],
          normalized: null,
        },
      },
      ...charts,
    });
    renderWithProviders(<DashboardView />);
    expect(await screen.findByText('No employees yet')).toBeInTheDocument();
  });
});
