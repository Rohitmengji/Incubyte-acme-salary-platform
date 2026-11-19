'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ErrorBar,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';
import type { DistributionRow, HistogramResponse, TrendsResponse } from '@acme/shared';
import { Table, Td, Th } from '@/components/ui/table';
import { Badge } from '@/components/ui/card';
import {
  formatCompactNumber,
  formatCount,
  formatMoney,
  formatMoneyCompact,
  formatMonth,
  formatDate,
} from '@/lib/format';
import { CHART_COLORS, ChartCard, ChartTooltip, toNumber } from './chart-card';

const axis = { fontSize: 12, fill: 'var(--color-slate-600)' };

export function HeadcountByCountryChart({
  data,
}: {
  data: { code: string; name: string; count: number }[];
}) {
  const top = data[0];
  return (
    <ChartCard
      title="Headcount by country"
      description="People employed today"
      summary={`Headcount by country. ${data.map((d) => `${d.name}: ${d.count}`).join(', ')}.${top ? ` Largest is ${top.name}.` : ''}`}
      chart={
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid horizontal={false} stroke="var(--color-slate-200)" />
            <XAxis type="number" tick={axis} allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={110} tick={axis} />
            <Tooltip
              cursor={{ fill: 'var(--color-slate-100)' }}
              content={({ active, payload }) => (
                <ChartTooltip
                  active={active}
                  label={(payload?.[0]?.payload as { name?: string } | undefined)?.name}
                  rows={[{ name: 'People', value: formatCount(Number(payload?.[0]?.value ?? 0)) }]}
                />
              )}
            />
            <Bar
              dataKey="count"
              name="People"
              fill={CHART_COLORS[0]}
              radius={[0, 4, 4, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      }
      table={
        <Table label="Headcount by country data">
          <thead>
            <tr>
              <Th scope="col">Country</Th>
              <Th scope="col" className="text-right">
                People
              </Th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.code}>
                <Td>{d.name}</Td>
                <Td className="tabular text-right">{formatCount(d.count)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      }
    />
  );
}

/** Median per group with the interquartile range (p25–p75) as an error bar; one currency only. */
export function MedianRangeChart({
  title,
  description,
  rows,
  currency,
  actions,
}: {
  title: string;
  description: React.ReactNode;
  rows: DistributionRow[];
  currency: string;
  actions?: React.ReactNode;
}) {
  const data = rows.map((r) => ({
    label: r.label,
    median: toNumber(r.median),
    range: [toNumber(r.median) - toNumber(r.p25), toNumber(r.p75) - toNumber(r.median)],
    row: r,
  }));
  return (
    <ChartCard
      title={title}
      description={description}
      actions={actions}
      summary={`${title} in ${currency}. ${rows.map((r) => `${r.label}: median ${formatMoney(r.median, currency)} across ${r.n} people`).join('; ')}.`}
      chart={
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
            <CartesianGrid horizontal={false} stroke="var(--color-slate-200)" />
            <XAxis
              type="number"
              tick={axis}
              tickFormatter={(v: number) => formatMoneyCompact(v, currency)}
            />
            <YAxis type="category" dataKey="label" width={140} tick={axis} interval={0} />
            <Tooltip
              cursor={{ fill: 'var(--color-slate-100)' }}
              content={({ active, payload }) => {
                const row = (payload?.[0]?.payload as { row?: DistributionRow } | undefined)?.row;
                return row ? (
                  <ChartTooltip
                    active={active}
                    label={row.label}
                    rows={[
                      { name: 'Median', value: formatMoney(row.median, currency) },
                      {
                        name: 'Middle 50%',
                        value: `${formatMoney(row.p25, currency)} – ${formatMoney(row.p75, currency)}`,
                      },
                      { name: 'People', value: formatCount(row.n) },
                    ]}
                  />
                ) : null;
              }}
            />
            <Bar
              dataKey="median"
              name="Median"
              fill={CHART_COLORS[0]}
              radius={[0, 4, 4, 0]}
              isAnimationActive={false}
            >
              <ErrorBar
                dataKey="range"
                width={6}
                strokeWidth={1.5}
                stroke="var(--color-slate-700)"
                direction="x"
                isAnimationActive={false}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      }
      table={<DistributionTable rows={rows} />}
    />
  );
}

export function DistributionTable({
  rows,
  showCurrency = false,
}: {
  rows: DistributionRow[];
  showCurrency?: boolean;
}) {
  return (
    <Table label="Salary statistics">
      <thead>
        <tr>
          <Th scope="col">Group</Th>
          {showCurrency ? <Th scope="col">Currency</Th> : null}
          <Th scope="col" className="text-right">
            People
          </Th>
          <Th scope="col" className="text-right">
            Minimum
          </Th>
          <Th scope="col" className="text-right">
            25th pct
          </Th>
          <Th scope="col" className="text-right">
            Median
          </Th>
          <Th scope="col" className="text-right">
            75th pct
          </Th>
          <Th scope="col" className="text-right">
            Maximum
          </Th>
          <Th scope="col" className="text-right">
            Average
          </Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.key}-${r.currency}`}>
            <Th
              scope="row"
              className="border-slate-100 bg-white text-sm font-medium tracking-normal text-slate-900 normal-case"
            >
              {r.label}
              {r.smallSample ? (
                <Badge
                  tone="warning"
                  className="ml-2"
                  title="Fewer than 5 people: the median and average are not representative"
                >
                  Small sample
                </Badge>
              ) : null}
            </Th>
            {showCurrency ? <Td>{r.currency}</Td> : null}
            <Td className="tabular text-right">{formatCount(r.n)}</Td>
            {[r.min, r.p25, r.median, r.p75, r.max, r.avg].map((value, i) => (
              <Td key={i} className="tabular text-right whitespace-nowrap">
                {formatMoney(value, r.currency)}
              </Td>
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function HistogramChart({
  data,
  actions,
}: {
  data: HistogramResponse;
  actions?: React.ReactNode;
}) {
  // The currency is named in the caption and table header, so band labels stay short ("80K–100K").
  const label = (b: HistogramResponse['buckets'][number]) =>
    b.to
      ? `${formatCompactNumber(b.from)}–${formatCompactNumber(b.to)}`
      : `${formatCompactNumber(b.from)}+`;
  const points = data.buckets.map((b) => ({ label: label(b), count: b.count }));
  const peak = [...points].sort((a, b) => b.count - a.count)[0];
  return (
    <ChartCard
      title="Compensation distribution"
      description={
        data.normalized
          ? `Annual salaries converted to USD at the ${formatDate(data.fx?.asOfDate)} snapshot (illustrative rates)`
          : `Annual salaries paid in ${data.currency}`
      }
      actions={actions}
      summary={`Histogram of annual salaries in ${data.currency}. ${peak ? `The most common band is ${peak.label} with ${peak.count} people.` : 'No data.'}`}
      chart={
        <ResponsiveContainer>
          <BarChart data={points} margin={{ left: 0, right: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--color-slate-200)" />
            <XAxis dataKey="label" tick={{ ...axis, fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tick={axis} allowDecimals={false} width={48} />
            <Tooltip
              cursor={{ fill: 'var(--color-slate-100)' }}
              content={({ active, payload }) => (
                <ChartTooltip
                  active={active}
                  label={(payload?.[0]?.payload as { label?: string } | undefined)?.label}
                  rows={[{ name: 'People', value: formatCount(Number(payload?.[0]?.value ?? 0)) }]}
                />
              )}
            />
            <Bar
              dataKey="count"
              name="People"
              fill={CHART_COLORS[0]}
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      }
      table={
        <Table label="Salary distribution data">
          <thead>
            <tr>
              <Th scope="col">Salary band ({data.currency})</Th>
              <Th scope="col" className="text-right">
                People
              </Th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.label}>
                <Td>{p.label}</Td>
                <Td className="tabular text-right">{formatCount(p.count)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      }
    />
  );
}

export function TrendsChart({ data }: { data: TrendsResponse }) {
  const points = data.points.map((p) => ({
    date: p.date,
    label: formatMonth(p.date),
    median: toNumber(p.median),
    avg: toNumber(p.avg),
    n: p.n,
    raw: p,
  }));
  const first = data.points[0];
  const last = data.points.at(-1);
  return (
    <ChartCard
      title="Salary trend"
      description={`Median and average for the people employed at each month end, in USD at one ${formatDate(data.fx?.asOfDate)} snapshot so currency moves do not distort the trend.`}
      summary={
        first && last
          ? `Median salary moved from ${formatMoney(first.median, 'USD')} in ${formatMonth(first.date)} to ${formatMoney(last.median, 'USD')} in ${formatMonth(last.date)}; headcount from ${first.n} to ${last.n}.`
          : 'No trend data.'
      }
      chart={
        <ResponsiveContainer>
          <LineChart data={points} margin={{ left: 8, right: 16 }}>
            <CartesianGrid vertical={false} stroke="var(--color-slate-200)" />
            <XAxis dataKey="label" tick={axis} interval="preserveStartEnd" />
            <YAxis
              tick={axis}
              width={72}
              tickFormatter={(v: number) => formatMoneyCompact(v, 'USD')}
              domain={['auto', 'auto']}
            />
            <Tooltip
              content={({ active, payload }) => {
                const raw = (
                  payload?.[0]?.payload as { raw?: TrendsResponse['points'][number] } | undefined
                )?.raw;
                return raw ? (
                  <ChartTooltip
                    active={active}
                    label={formatDate(raw.date)}
                    rows={[
                      { name: 'Median', value: formatMoney(raw.median, 'USD') },
                      { name: 'Average', value: formatMoney(raw.avg, 'USD') },
                      { name: 'People', value: formatCount(raw.n) },
                    ]}
                  />
                ) : null;
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="median"
              name="Median"
              stroke={CHART_COLORS[0]}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="avg"
              name="Average"
              stroke={CHART_COLORS[1]}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      }
      table={
        <Table label="Salary trend data">
          <thead>
            <tr>
              <Th scope="col">Month end</Th>
              <Th scope="col" className="text-right">
                People
              </Th>
              <Th scope="col" className="text-right">
                Median (USD)
              </Th>
              <Th scope="col" className="text-right">
                Average (USD)
              </Th>
            </tr>
          </thead>
          <tbody>
            {data.points.map((p) => (
              <tr key={p.date}>
                <Td>{formatDate(p.date)}</Td>
                <Td className="tabular text-right">{formatCount(p.n)}</Td>
                <Td className="tabular text-right">{formatMoney(p.median, 'USD')}</Td>
                <Td className="tabular text-right">{formatMoney(p.avg, 'USD')}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      }
    />
  );
}
