import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AnalyticsView } from '@/features/analytics/analytics-view';
import { mockApi, renderWithProviders } from './utils';

const fx = { asOfDate: '2026-10-31', source: 'Illustrative', reportingCurrency: 'USD' };
const row = (key: string, label: string) => ({
  key,
  label,
  currency: 'USD',
  n: 12,
  min: '50000.00',
  max: '150000.00',
  avg: '90000.00',
  median: '88000.00',
  p25: '70000.00',
  p75: '110000.00',
  total: '1080000.00',
  smallSample: false,
});

describe('AnalyticsView', () => {
  it('keeps labelling the previous results by what they contain while a new grouping loads', async () => {
    let finish: (value: { body: unknown }) => void = () => {};
    mockApi({
      'GET /analytics/distribution': ({ url }) => {
        const body = (dimension: string, rows: unknown[]) => ({
          body: { asOf: '2026-11-19', dimension, currencyMode: 'normalized', fx, rows },
        });
        return url.searchParams.get('dimension') === 'country'
          ? new Promise((resolve) => (finish = resolve)).then(() =>
              body('country', [row('US', 'United States')]),
            )
          : body('department', [row('1', 'Engineering')]);
      },
      'GET /analytics/trends': { body: { asOf: '2026-11-19', fx, points: [] } },
      'GET /analytics/histogram': {
        body: { asOf: '2026-11-19', currency: 'USD', normalized: true, fx, buckets: [] },
      },
      'GET /reference-data': {
        body: {
          countries: [],
          currencies: [],
          departments: [],
          jobTitles: [],
          statuses: [],
          compensationReasons: [],
        },
      },
    });
    renderWithProviders(<AnalyticsView />);
    expect(await screen.findByText('Statistics by department')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Country' }));
    // Still the department data on screen, so still labelled as such, and marked as updating.
    expect(screen.getByText('Statistics by department')).toBeInTheDocument();
    expect(screen.getByText('Statistics by department').closest('[aria-busy]')).toHaveAttribute(
      'aria-busy',
      'true',
    );

    finish({ body: undefined });
    expect(await screen.findByText('Statistics by country')).toBeInTheDocument();
  });
});
