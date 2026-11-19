'use client';

import Link from 'next/link';
import type { AnalyticsSummary, PayStats } from '@acme/shared';
import {
  HeadcountByCountryChart,
  HistogramChart,
  MedianRangeChart,
} from '@/components/charts/charts';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  Skeleton,
} from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td, Th } from '@/components/ui/table';
import { formatCount, formatDate, formatMoney, formatTimestamp, humanize } from '@/lib/format';
import { useDistribution, useHistogram, useRecentChanges, useSummary } from '@/lib/queries';

function Kpi({
  label,
  value,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent>
        <p className="text-sm font-medium text-slate-600">{label}</p>
        <p className="tabular mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
        {detail ? <p className="mt-1 text-xs text-slate-600">{detail}</p> : null}
      </CardContent>
    </Card>
  );
}

function KpiSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-3 w-40" />
      </CardContent>
    </Card>
  );
}

function FxNote({ summary }: { summary: AnalyticsSummary }) {
  return summary.fx ? (
    <>
      USD at the {formatDate(summary.fx.asOfDate)} FX snapshot (illustrative rates)
      {summary.missingFxRates
        ? ` · ${formatCount(summary.missingFxRates)} people without a rate are excluded`
        : ''}
    </>
  ) : (
    'No FX snapshot available'
  );
}

function PayByCurrency({ rows }: { rows: PayStats[] }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Pay by currency</CardTitle>
          <CardDescription>
            Annual base salary in each pay currency. Currencies are never added together; see
            Analytics for full ranges.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table label="Pay by currency">
          <thead>
            <tr>
              <Th scope="col">Currency</Th>
              <Th scope="col" className="text-right">
                People
              </Th>
              <Th scope="col" className="text-right">
                Median
              </Th>
              <Th scope="col" className="text-right">
                Average
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.currency}>
                <Th
                  scope="row"
                  className="border-slate-100 bg-white text-sm font-medium text-slate-900"
                >
                  {r.currency}
                  {r.smallSample ? (
                    <Badge tone="warning" className="ml-2">
                      Small sample
                    </Badge>
                  ) : null}
                </Th>
                <Td className="tabular text-right">{formatCount(r.n)}</Td>
                <Td className="tabular text-right whitespace-nowrap">
                  {formatMoney(r.median, r.currency)}
                </Td>
                <Td className="tabular text-right whitespace-nowrap">
                  {formatMoney(r.avg, r.currency)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </CardContent>
    </Card>
  );
}

function RecentChanges() {
  const recent = useRecentChanges();
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Recent salary changes</CardTitle>
          <CardDescription>Latest changes and corrections from the audit trail</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {recent.isPending ? (
          <LoadingState label="Loading recent changes" />
        ) : recent.error ? (
          <ErrorState error={recent.error} onRetry={() => void recent.refetch()} />
        ) : recent.data.length === 0 ? (
          <EmptyState
            title="No salary changes yet"
            description="Changes made in the app will appear here with who made them."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.data.map((change) => {
              const after = change.after;
              const currency = after.currencyCode ?? change.currencyCode;
              return (
                <li
                  key={change.id}
                  className="flex flex-wrap items-start justify-between gap-2 py-3"
                >
                  <div>
                    <Link
                      href={`/employees/${change.employee.id}`}
                      className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
                    >
                      {change.employee.firstName} {change.employee.lastName}
                    </Link>{' '}
                    <span className="font-mono text-xs text-slate-500">
                      {change.employee.employeeCode}
                    </span>
                    <p className="text-sm text-slate-600">
                      {change.action === 'COMPENSATION_CORRECTED'
                        ? 'Corrected'
                        : humanize(after.reason ?? 'Salary change')}
                      {after.effectiveFrom ? ` · effective ${formatDate(after.effectiveFrom)}` : ''}
                      {change.correctionReason ? ` · “${change.correctionReason}”` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    {after.amount && currency ? (
                      <p className="tabular font-medium text-slate-900">
                        {change.before?.amount ? (
                          <span className="mr-1 text-sm font-normal text-slate-500 line-through">
                            {formatMoney(
                              change.before.amount,
                              change.before.currencyCode ?? currency,
                            )}
                          </span>
                        ) : null}
                        {formatMoney(after.amount, currency)}
                      </p>
                    ) : null}
                    <p className="text-xs text-slate-500">
                      {formatTimestamp(change.occurredAt)} · {change.actor?.displayName ?? 'System'}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardView() {
  const summary = useSummary();
  const departments = useDistribution('department', 'normalized');
  const histogram = useHistogram(null);

  const s = summary.data;
  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          s ? `How ACME pays its people, as of ${formatDate(s.asOf)}.` : 'How ACME pays its people.'
        }
      />

      {summary.error ? (
        <Card className="mb-6">
          <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
        </Card>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {!s ? (
          summary.error ? null : (
            <>
              <KpiSkeleton />
              <KpiSkeleton />
              <KpiSkeleton />
              <KpiSkeleton />
            </>
          )
        ) : (
          <>
            <Kpi
              label="Employee records"
              value={formatCount(s.records.total)}
              detail={`${formatCount(s.records.byStatus.ACTIVE)} active · ${formatCount(s.records.byStatus.ON_LEAVE)} on leave · ${formatCount(s.records.byStatus.INACTIVE)} inactive`}
            />
            <Kpi
              label="Employed today"
              value={formatCount(s.employedHeadcount)}
              detail={`Across ${s.headcountByCountry.length} countries`}
            />
            <Kpi
              label="Median salary (USD)"
              value={s.normalized ? formatMoney(s.normalized.median, 'USD') : '—'}
              detail={<FxNote summary={s} />}
            />
            <Kpi
              label="Average salary (USD)"
              value={s.normalized ? formatMoney(s.normalized.avg, 'USD') : '—'}
              detail={`${formatCount(s.payByCurrency.length)} pay currencies · see breakdown below`}
            />
          </>
        )}
      </div>

      {s && s.records.total === 0 ? (
        <Card>
          <EmptyState
            title="No employees yet"
            description="Add employees or import a spreadsheet to see how ACME pays its people."
            action={
              <Link href="/employees/new" className="text-brand-700 underline">
                Add an employee
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {s ? (
            <PayByCurrency rows={s.payByCurrency} />
          ) : (
            <Card>
              <CardContent>
                <LoadingState label="Loading pay by currency" rows={6} />
              </CardContent>
            </Card>
          )}
          {s ? (
            <HeadcountByCountryChart data={s.headcountByCountry} />
          ) : (
            <Card>
              <CardContent>
                <LoadingState label="Loading headcount" rows={6} />
              </CardContent>
            </Card>
          )}

          {departments.data ? (
            <MedianRangeChart
              title="Salary by department"
              description={`Median with the middle 50% (bar marker), USD at the ${formatDate(departments.data.fx?.asOfDate)} snapshot`}
              rows={departments.data.rows}
              currency="USD"
            />
          ) : (
            <Card>
              {departments.error ? (
                <ErrorState error={departments.error} onRetry={() => void departments.refetch()} />
              ) : (
                <CardContent>
                  <LoadingState label="Loading salary by department" rows={6} />
                </CardContent>
              )}
            </Card>
          )}

          {histogram.data ? (
            <HistogramChart data={histogram.data} />
          ) : (
            <Card>
              {histogram.error ? (
                <ErrorState error={histogram.error} onRetry={() => void histogram.refetch()} />
              ) : (
                <CardContent>
                  <LoadingState label="Loading distribution" rows={6} />
                </CardContent>
              )}
            </Card>
          )}

          <div className="xl:col-span-2">
            <RecentChanges />
          </div>
        </div>
      )}
    </>
  );
}
