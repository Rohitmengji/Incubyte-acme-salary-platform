'use client';

import { useMemo, useState } from 'react';
import type { AnalyticsDimension, CurrencyMode } from '@acme/shared';
import {
  DistributionTable,
  HistogramChart,
  MedianRangeChart,
  TrendsChart,
} from '@/components/charts/charts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
} from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Segmented } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { useDistribution, useHistogram, useReferenceData, useTrends } from '@/lib/queries';

const DIMENSIONS: { value: AnalyticsDimension; label: string }[] = [
  { value: 'country', label: 'Country' },
  { value: 'department', label: 'Department' },
  { value: 'jobTitle', label: 'Job title' },
];

const MODES: { value: CurrencyMode; label: string }[] = [
  { value: 'local', label: 'Pay currency' },
  { value: 'normalized', label: 'USD (normalised)' },
];

function SectionFallback({
  query,
  label,
}: {
  query: { error: unknown; refetch: () => unknown };
  label: string;
}) {
  return (
    <Card>
      {query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <CardContent>
          <LoadingState label={label} rows={6} />
        </CardContent>
      )}
    </Card>
  );
}

export function AnalyticsView() {
  const [dimension, setDimension] = useState<AnalyticsDimension>('department');
  const [mode, setMode] = useState<CurrencyMode>('normalized');
  const [chartCurrency, setChartCurrency] = useState<string | null>(null);
  const [histogramCurrency, setHistogramCurrency] = useState<string | null>(null);

  const distribution = useDistribution(dimension, mode);
  const trends = useTrends(24);
  const histogram = useHistogram(histogramCurrency);
  const reference = useReferenceData();

  const rows = useMemo(() => distribution.data?.rows ?? [], [distribution.data]);
  // While a new grouping loads, the previous result stays on screen; label it by what it actually
  // contains (from the response), not by the newly selected controls.
  const shownMode = distribution.data?.currencyMode ?? mode;
  const shownDimension = distribution.data?.dimension ?? dimension;
  const updating = distribution.isPlaceholderData;
  // In pay-currency mode a chart can only compare groups paid in the same currency.
  const currencies = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of rows) totals.set(r.currency, (totals.get(r.currency) ?? 0) + r.n);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [rows]);
  const selectedCurrency =
    shownMode === 'normalized'
      ? 'USD'
      : chartCurrency && currencies.includes(chartCurrency)
        ? chartCurrency
        : (currencies[0] ?? 'USD');
  const chartRows = rows.filter((r) => r.currency === selectedCurrency);
  const dimensionLabel = DIMENSIONS.find((d) => d.value === shownDimension)!.label.toLowerCase();

  return (
    <>
      <PageHeader
        title="Salary analytics"
        description="Distribution of current annual base salaries for people employed today. Computed on the server from live data."
      />

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span id="group-by-label" className="text-sm font-medium text-slate-700">
            Group by
          </span>
          <Segmented
            label="Group by"
            value={dimension}
            onChange={setDimension}
            options={DIMENSIONS}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700">Show amounts in</span>
          <Segmented label="Show amounts in" value={mode} onChange={setMode} options={MODES} />
        </div>
        {shownMode === 'normalized' && distribution.data?.fx ? (
          <p className="text-xs text-slate-600">
            Converted at the {formatDate(distribution.data.fx.asOfDate)} snapshot.{' '}
            {distribution.data.fx.source}.
          </p>
        ) : null}
      </div>

      <div className="grid gap-6">
        {distribution.data ? (
          <div
            className={updating ? 'grid gap-6 opacity-60 transition-opacity' : 'grid gap-6'}
            aria-busy={updating}
          >
            {rows.length === 0 ? (
              <Card>
                <EmptyState
                  title="No salary data"
                  description="There is nobody with a current salary to analyse yet."
                />
              </Card>
            ) : (
              <>
                <MedianRangeChart
                  title={`Median salary by ${dimensionLabel}`}
                  description={
                    shownMode === 'normalized'
                      ? 'Median with the middle 50% (marker). All pay converted to USD.'
                      : `Groups paid in ${selectedCurrency}. Choose another currency to compare its groups.`
                  }
                  rows={chartRows}
                  currency={selectedCurrency}
                  actions={
                    shownMode === 'local' ? (
                      <div className="flex items-center gap-2">
                        <label htmlFor="chart-currency" className="text-sm text-slate-700">
                          Currency
                        </label>
                        <Select
                          id="chart-currency"
                          value={selectedCurrency}
                          onChange={(e) => setChartCurrency(e.target.value)}
                          className="h-8 w-28"
                        >
                          {currencies.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </Select>
                      </div>
                    ) : null
                  }
                />
                <Card>
                  <CardHeader>
                    <div>
                      <CardTitle>Statistics by {dimensionLabel}</CardTitle>
                      <CardDescription>
                        {shownMode === 'normalized'
                          ? 'All amounts in USD at the snapshot rate.'
                          : 'One row per group and pay currency, so amounts are never mixed across currencies.'}{' '}
                        Groups with fewer than 5 people are marked as a small sample.
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <DistributionTable rows={rows} showCurrency={shownMode === 'local'} />
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        ) : (
          <SectionFallback query={distribution} label="Loading distribution" />
        )}

        <div className="grid gap-6 xl:grid-cols-2">
          {trends.data ? (
            <TrendsChart data={trends.data} />
          ) : (
            <SectionFallback query={trends} label="Loading trend" />
          )}
          {histogram.data ? (
            <HistogramChart
              data={histogram.data}
              actions={
                <div className="flex items-center gap-2">
                  <label htmlFor="histogram-currency" className="text-sm text-slate-700">
                    Currency
                  </label>
                  <Select
                    id="histogram-currency"
                    value={histogramCurrency ?? ''}
                    onChange={(e) => setHistogramCurrency(e.target.value || null)}
                    className="h-8 w-52"
                  >
                    <option value="">USD (normalised)</option>
                    {(reference.data?.currencies ?? []).map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} (pay currency)
                      </option>
                    ))}
                  </Select>
                </div>
              }
            />
          ) : (
            <SectionFallback query={histogram} label="Loading distribution" />
          )}
        </div>
      </div>
    </>
  );
}
