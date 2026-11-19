'use client';

import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const CHART_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
];

/** Chart values are decimal strings; converting for plotting is display-only and never stored. */
export const toNumber = (value: string | null | undefined): number => (value ? Number(value) : 0);

/**
 * A chart card that is accessible without seeing the chart: the SVG is summarised for screen
 * readers and the exact figures are available as a table in a native <details> disclosure.
 */
export function ChartCard({
  title,
  description,
  summary,
  actions,
  chart,
  table,
  className,
}: {
  title: string;
  description?: ReactNode;
  summary: string;
  actions?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {actions}
      </CardHeader>
      <CardContent>
        <figure>
          <div role="img" aria-label={summary} className="h-72 w-full">
            {chart}
          </div>
          <figcaption className="sr-only">{summary}</figcaption>
        </figure>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-brand-700 hover:underline">
            Show data table
          </summary>
          <div className="mt-2 max-h-80 overflow-auto">{table}</div>
        </details>
      </CardContent>
    </Card>
  );
}

export function ChartTooltip({
  active,
  label,
  rows,
}: {
  active?: boolean;
  label?: ReactNode;
  rows: { name: string; value: string }[];
}) {
  if (!active) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      {label ? <p className="mb-1 font-medium text-slate-900">{label}</p> : null}
      {rows.map((row) => (
        <p key={row.name} className="tabular text-slate-700">
          {row.name}: <span className="font-medium text-slate-900">{row.value}</span>
        </p>
      ))}
    </div>
  );
}
