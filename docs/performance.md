# Performance

These are measurements from a real run, not estimates. Where something hasn't been measured yet, it says so.

## Environment for the measurements below

|          |                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Machine  | Apple Silicon (arm64) laptop, macOS 26.7                                                                                       |
| Runtime  | Node.js 26.13                                                                                                                  |
| Database | Embedded PostgreSQL 18.6 (`npm run setup`, default settings), on the same machine                                              |
| Data     | Deterministic seed: 10,000 employees (one extra smoke-test employee was present for the latency run) and 17,830 salary periods |
| Date     | 2026-11-19                                                                                                                     |

## Seed

| Run                                                             | Result                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------- |
| First run into an empty database                                | 10,000 employees + 17,830 salary periods in **3.7–3.8 s** |
| Second run (idempotent)                                         | 0 rows inserted in **1.7–1.8 s**; totals unchanged        |
| Dataset checksum (both runs, and after rebuilding the database) | `195856c2…714c715b1`, identical                           |

The seed writes in chunks of 1,000 using `createManyAndReturn` / `createMany`, one transaction per chunk, and doesn't query each employee individually.

## API latency (backend only)

Method: the production bundle (`npm run build && npm start`), an authenticated session, 5 warm-up requests and then 100 sequential requests per scenario. The time measured is the full HTTP round trip on localhost. Every response was checked to be `200`.

| Scenario                                                    | p50    | p95     |
| ----------------------------------------------------------- | ------ | ------- |
| Employee list, page 1 of 400 (25 rows, with current salary) | 2.8 ms | 4.1 ms  |
| Employee list, last page (`page=400`)                       | 9.6 ms | 10.7 ms |
| Search `sha` and sort by hire date                          | 2.5 ms | 3.1 ms  |
| Filters: 2 countries + department + status                  | 2.4 ms | 3.0 ms  |
| Sort by department name, page 50                            | 8.9 ms | 10.0 ms |
| Employee detail                                             | 1.4 ms | 2.2 ms  |
| Salary history                                              | 1.2 ms | 1.5 ms  |

The target was a p95 under 200 ms for the employee list ([requirements](./requirements.md)). It's met with a lot of headroom.

**A measurement mistake I caught.** The first benchmark run exceeded the API's own rate limit of 600 requests per minute per IP. The last scenarios were then measuring fast `429` responses: salary history looked like 0.3 ms. The table above comes from a second run with the limit raised for the benchmark only, and with each status code asserted.

## Analytics and export latency

Method: the API dev server (`tsx`, same database as above), an authenticated session, 3 warm-up requests, then 30 sequential requests (10 for the export), all asserted to return `200`. Measured on 2026-11-19.

| Endpoint                                                                                                    | p50          | p95          |
| ----------------------------------------------------------------------------------------------------------- | ------------ | ------------ |
| `GET /analytics/summary` (status counts, headcount by country, per-currency and normalised stats, FX check) | 21.1 ms      | 32.1 ms      |
| `GET /analytics/distribution` (department, normalised)                                                      | 24.2 ms      | 25.0 ms      |
| `GET /analytics/distribution` (country, local currencies)                                                   | 25.1 ms      | 25.5 ms      |
| `GET /analytics/distribution` (job title, local currencies)                                                 | 24.8 ms      | 25.5 ms      |
| `GET /analytics/histogram` (USD) / (JPY)                                                                    | 7.3 / 4.8 ms | 8.3 / 5.3 ms |
| `GET /analytics/trends?months=24`                                                                           | 292.4 ms     | 302.2 ms     |
| `GET /analytics/recent-changes`                                                                             | 2.0 ms       | 2.6 ms       |
| `GET /exports/employees.csv` (all 10,000 rows with current salaries, streamed)                              | 204.4 ms     | 210.8 ms     |

The dashboard loads summary, distribution, histogram and recent changes in parallel, so it waits mostly on the slowest of these (about 30 ms). That's well inside the 500 ms target.

**Trends: a plan problem found and fixed.** The trend computes an exact median for the people employed at each of 24 month ends, which means about 212,000 joined rows.

- The first version took **about 550 ms**. `EXPLAIN ANALYZE` showed PostgreSQL inlining the `months` CTE, so it re-evaluated the month-end expression for every joined row. It also showed the sort spilling to disk (external merge, 4.4 MB).
- Marking the CTE `MATERIALIZED` brought it to **about 310–325 ms** in `EXPLAIN` and about 300 ms p95 end to end.
- Raising `work_mem` to 32 MB removed the disk spill but saved only about 15 ms, so it wasn't kept. Fewer tuning knobs means less to explain and maintain.
- If trends ever need to be faster, the next step would be a monthly snapshot table maintained on write, but that isn't justified at this size (ADR-0004).

## Query plans (`EXPLAIN ANALYZE`, 10k employees)

| Query                                                       | Plan                                                                    | Execution |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- | --------- |
| Search `%sha%` across first name, last name and employee ID | Bitmap OR of the three `pg_trgm` GIN indexes                            | 0.41 ms   |
| Search `%EMP-00004%`                                        | Same; `employee_code_trgm_idx` does the work                            | 0.31 ms   |
| Default page (sort by last name, first name, id)            | Index-only scan on `employee_last_name_first_name_id_idx`               | 0.08 ms   |
| Last page (`OFFSET 9975`)                                   | Same index; walks about 10k index entries                               | 0.79 ms   |
| Filters country + department + status, sorted               | Index scan on the sort index, filter applied                            | 0.09 ms   |
| Current salary for one page of 25                           | One batched query; index scan on `UNIQUE (employee_id, effective_from)` | 0.11 ms   |

## Decisions and why

- **Server-side pagination with `OFFSET`.** Even the deepest page costs under 1 ms in the database at this size, and HR users expect page numbers. Keyset pagination would only pay off at a much larger scale.
- **Trigram indexes for `contains` search.** Search is `ILIKE '%term%'` on three columns. B-tree indexes can't serve a leading wildcard, but GIN with `gin_trgm_ops` can, as the plans above show.
- **Every sort ends in a unique column** (`id` or `employee_code`), so rows never repeat or go missing between pages.
- **No N+1 queries.** The current salary for a whole page comes from one batched query (verified in the plan above), not one query per employee.
- **Only the needed columns are selected** for list and detail responses. `select` is used throughout, never `include` of whole models.
- **No cache.** Nothing above is slow enough to justify one, and salary data must be fresh. Responses are sent with `Cache-Control: no-store`.

## Frontend

- **No data volume in the browser.** Lists and analytics only ever carry one page (≤ 100 rows) or aggregated rows. The 10,000 employees are never sent to the browser.
- **Search** is debounced by 300 ms, and superseded requests are cancelled with `AbortSignal`, so fast typing doesn't queue requests. A component test asserts that typing a whole term sends one search request, not one per keystroke.
- **No layout jump while paging.** TanStack Query's `placeholderData` keeps the current page visible while the next one loads.
- **Static by default.** The production build pre-renders every route except `/employees/[id]`. Data is fetched on the client through the same-origin `/api` path.

## Not measured yet

- Frontend bundle size and Core Web Vitals. Next.js 16 no longer prints per-route sizes during `next build`, and no lab measurement (Lighthouse) has been taken yet.
- Behaviour under concurrent load. All numbers above are sequential, from a single client.
