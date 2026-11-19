# ADR-0004: Compute analytics in PostgreSQL on every read, and add no cache until measurements show a need

**Status:** Accepted · 2026-11-19

## Context

The dashboard and analytics pages need medians and quartiles, min and max, averages and histograms across about 10,000 current salaries, grouped by country, department, job title and currency, plus monthly trends from history.

Doing that in the browser would mean sending every salary to it. Doing it in Node would mean loading every row into memory. Prisma's `groupBy` can't compute percentiles. Every salary write changes the answers, so a cache would risk showing stale numbers about sensitive data.

## Decision

- An `AnalyticsRepository` runs parameterised `$queryRaw` tagged-template SQL using `avg`, `min`/`max`, `count`, `width_bucket` and `generate_series`. Every query takes an `asOf` date.
- The median is computed exactly in `NUMERIC` from the middle row, or two middle rows (`row_number()`). Quartiles use `percentile_disc`. `percentile_cont` isn't used because it returns `double precision` even for `NUMERIC` input; that was checked on PostgreSQL 18.6 during design. Results are grouped by currency unless normalised mode is requested ([ADR-0002](./0002-money-and-multi-currency-analytics.md)).
- Raw rows are validated with Zod at the repository boundary, because raw SQL bypasses Prisma's types. Integration tests compare results with values worked out by hand from a small fixture dataset.
- **No server cache.** That means no Redis and no materialized views. API responses carry `Cache-Control: no-store`. The only caching is TanStack Query's short client-side `staleTime`.
- Queries are measured with `EXPLAIN (ANALYZE, BUFFERS)` against the 10,000-employee seed and recorded in `performance.md`. A materialized view or cache would only be added if the dashboard API went over its 500 ms p95 target, and that decision would be recorded in a new ADR.

## Alternatives considered

- **Prisma `groupBy` with medians computed in JavaScript.** It ships every row into Node and duplicates work the database does better.
- **Materialized views refreshed on write.** They add staleness and refresh complexity before any measurement shows a need.
- **A Redis cache.** It's extra infrastructure, salary writes would need cache invalidation, and it means a second store holding sensitive data.
- **A separate analytics warehouse.** Far out of scope at this size.

## Consequences

- **Gains:** results always match the latest write, and there are no moving parts.
- **Costs:** the SQL has to be maintained without Prisma's type safety, which the Zod parsing and fixture tests make up for. Query cost grows with data. That's fine for tens of thousands of employees, but should be reviewed at hundreds of thousands.
- **Revisit if:** the measured p95 goes over target, or the data grows by an order of magnitude.
