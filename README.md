# ACME Salary Management Platform

ACME's HR team keeps salaries for 10,000 employees across several countries in Excel. This is a web app that replaces those spreadsheets. HR managers can maintain employee and salary records with a full audit trail, import and export their spreadsheets, and see how the organisation pays its people without mixing currencies.

> **Status:** the full stack is built and tested locally.
>
> - **Built:** a Next.js web app and an Express API, backed by PostgreSQL with exactly 10,000 synthetic employees.
> - **Tests:** 232 automated unit, integration and component tests, plus 19 Playwright end-to-end tests with accessibility scans.
> - **Not done yet:** Docker files and the hosted deployment. See the [implementation plan](docs/implementation-plan.md).

## Reviewer quick start

The only prerequisite is **Node.js 24 or newer** (developed on Node 26 LTS; see `.nvmrc`). You **don't** need Docker or a PostgreSQL install: `npm run setup` downloads and runs a local PostgreSQL 18 through npm.

```bash
npm install
npm run setup   # creates apps/api/.env, starts local PostgreSQL on :54329, migrates, seeds 10,000 employees
npm run dev     # web app on http://localhost:3000 (API on :4000, reached through the web app)
```

Open **http://localhost:3000** and sign in. These accounts are for local development only, and the passwords come from `apps/api/.env`:

| Role       | Email                     | Password             | Can                                                                                  |
| ---------- | ------------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| HR Manager | `hr.manager@acme.example` | `Manager-Demo-2026!` | Everything: create, edit, deactivate, change and correct salaries, import and export |
| HR Viewer  | `hr.viewer@acme.example`  | `Viewer-Demo-2026!`  | Read only (dashboard, employees, salary history, analytics)                          |

### Running the tests

```bash
npm test                          # unit + integration + component tests (API uses a separate acme_test database)
npx playwright install chromium   # once, to download the test browser
npm run test:e2e                  # browser journeys on an isolated acme_e2e database (ports 3100/4100)
npm run lint && npm run typecheck
```

## What you can do

| Area                | Highlights                                                                                                                                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Dashboard**       | Employee records by status, employed headcount, a USD-normalised median and average labelled with the FX snapshot date, pay by currency (never summed across currencies), headcount by country, salary by department with the middle 50% range, a compensation histogram, and recent salary changes from the audit trail |
| **Employees**       | Server-side search by name or employee ID (debounced), filters by country, department, job title and status, sortable columns, and pagination. All of it lives in the URL, so views can be shared and back/forward works. Add an employee together with their starting salary. Export the filtered list to CSV.          |
| **Employee detail** | Current salary, tenure, and salary history with _current_ and _scheduled_ markers. Add a salary change on any date, including future ones. Correct a record (a reason is required). Edit details, deactivate, or undo a mistaken deactivation. A full audit trail with before and after values.                          |
| **Analytics**       | Group by country, department or job title. Show amounts in each pay currency, or in USD at the dated snapshot. Shows min, 25th percentile, median, 75th percentile, max and average, with small-sample warnings, a 24-month trend of the people employed at each month end, and histograms.                              |
| **Import & export** | Upload a CSV and get a preview with row-level problems (invalid rows, duplicates within the file or already in the database). Importing the valid rows is one transaction, and it can only happen once. A downloadable template, and a CSV export that spreadsheets can open safely.                                     |

Every chart has a text summary for screen readers and a _Show data table_ option. The layout works on desktop, tablet and phone.

## Commands

| Command                                                       | What it does                                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run setup`                                               | Idempotent. Starts the local DB, applies migrations and seeds. Safe to run repeatedly.                                                           |
| `npm run dev`                                                 | Starts the local DB, the API (`:4000`, watch mode) and the web app (`:3000`) together                                                            |
| `npm run build` then `npm start`                              | Production builds of both apps, then runs them                                                                                                   |
| `npm test` · `npm run test:e2e`                               | Unit, integration and component tests · Playwright end-to-end tests                                                                              |
| `npm run lint` · `npm run typecheck` · `npm run format:check` | Static checks                                                                                                                                    |
| `npm run db:start` / `npm run db:stop`                        | Start or stop the local PostgreSQL (data lives in `.data/`, which is git-ignored)                                                                |
| `npm run db:reset`                                            | Drops and rebuilds the **local** dev database and re-seeds exactly 10,000 employees. Refuses to touch anything except the local embedded server. |

**Using your own PostgreSQL instead.** Set `EMBEDDED_POSTGRES=0` and point `DATABASE_URL` and `TEST_DATABASE_URL` in `apps/api/.env` at your server (PostgreSQL 16+). You'll need permission to create the `pg_trgm` and `btree_gist` extensions.

**Port conflicts.** If port 54329 is busy, set `LOCAL_PG_PORT` and update the URLs in `apps/api/.env` to match. The web app forwards `/api/*` to `API_ORIGIN` (default `http://localhost:4000`).

## Architecture in one paragraph

The browser only talks to the Next.js app (App Router, React 19, Tailwind 4, Radix primitives, TanStack Query and Table, Recharts, React Hook Form and Zod). The app forwards `/api/*` to the Express 5 API, so the HttpOnly session cookie stays first-party ([ADR-0001](docs/adr/0001-same-origin-api-and-cookie-sessions.md)).

The API validates every request with the same Zod schemas the forms use (`packages/shared`) and enforces roles on every route. It keeps salary history as an effective-dated timeline guarded by a PostgreSQL exclusion constraint ([ADR-0003](docs/adr/0003-salary-history-as-db-guarded-timeline.md)), writes the audit trail in the same transaction as each change, and computes analytics in SQL with exact decimal medians ([ADR-0002](docs/adr/0002-money-and-multi-currency-analytics.md), [ADR-0004](docs/adr/0004-analytics-in-sql-without-cache.md)). Full details are in [docs/architecture.md](docs/architecture.md).

## API overview (`/api/v1`)

Responses are JSON, and errors use [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json` with a `requestId`. Money is always a decimal **string** plus a currency, for example `{"amount": "1800000.00", "currency": "INR"}`.

| Method and path                                                                           | Purpose                                                                                            | Role                        |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------- |
| `POST /auth/login` · `POST /auth/logout` · `GET /auth/me`                                 | Session lifecycle. Login is rate-limited.                                                          | public / any / any          |
| `GET /reference-data`                                                                     | Countries, currencies, departments, job titles, statuses and reasons                               | viewer+                     |
| `GET /employees`                                                                          | `search`, `country`, `department`, `jobTitle`, `status`, `sort`, `order`, `page`, `pageSize` ≤ 100 | viewer+                     |
| `POST /employees` · `GET`/`PATCH /employees/{id}`                                         | Create with starting salary / detail / edit (send `version`)                                       | manager / viewer+ / manager |
| `POST /employees/{id}/deactivate` · `/reactivate`                                         | Deactivate / undo a mistaken deactivation                                                          | manager                     |
| `GET /employees/{id}/audit-events`                                                        | Audit trail                                                                                        | viewer+                     |
| `GET`/`POST /employees/{id}/compensations` · `PATCH …/{compensationId}`                   | History / add a change / correct (send `version` and `correctionReason`)                           | viewer+ / manager / manager |
| `GET /analytics/summary` · `/distribution` · `/histogram` · `/trends` · `/recent-changes` | Dashboard and analytics                                                                            | viewer+                     |
| `POST /imports` · `GET /imports/{id}` · `POST /imports/{id}/commit`                       | CSV preview and commit (CSV text in a JSON body)                                                   | manager                     |
| `GET /exports/employees.csv`                                                              | Filtered CSV export, streamed and audited                                                          | manager                     |
| `GET /health`                                                                             | Liveness plus a database check                                                                     | public                      |

## Repository layout

```text
apps/api/            Express 5 API, Prisma schema + migrations, deterministic seed, unit/integration tests
apps/web/            Next.js 16 app: src/app (routes), src/features (screens), src/components (UI kit, charts),
                     src/lib (API client, queries, formatting), src/tests (React Testing Library)
packages/shared/     Zod request schemas, DTO types, money and date rules used by both apps
e2e/                 Playwright journeys, axe checks and the mobile run
docs/                requirements, architecture, ADRs, plan, performance, AI log
```

## Documentation

| Document                                                                   | Purpose                                             |
| -------------------------------------------------------------------------- | --------------------------------------------------- |
| [docs/requirements.md](docs/requirements.md)                               | One-page requirements                               |
| [docs/architecture.md](docs/architecture.md)                               | System design, data model, flows, security, testing |
| [docs/adr/](docs/adr/)                                                     | Architecture decision records                       |
| [docs/implementation-plan.md](docs/implementation-plan.md)                 | Phased plan and current status                      |
| [docs/performance.md](docs/performance.md)                                 | Measured seed time, API latency and query plans     |
| [docs/production-readiness-review.md](docs/production-readiness-review.md) | Review findings, fixes and how each was verified    |
| [docs/ai-development-log.md](docs/ai-development-log.md)                   | How AI assistance was used, checked and corrected   |

## Security note

The app follows a reasonable security baseline for an assessment:

- Argon2id password hashing.
- HttpOnly session cookies.
- Role checks on every API route.
- Rate limiting and origin checks.
- A Content Security Policy.
- An append-only audit trail.
- CSV exports protected against formula injection.
- Synthetic data only.

It is **not** certified as production-compliant. See [architecture §10](docs/architecture.md#10-security-model) and the [production-readiness review](docs/production-readiness-review.md).

Settings that matter when running it anywhere other than your laptop:

| Setting                                          | App | Default                       | Meaning                                                                                                                                                         |
| ------------------------------------------------ | --- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST`                                           | API | `127.0.0.1`                   | Interface the API listens on. Keep it on loopback unless something other than the web app's proxy must reach the API.                                           |
| `LOGIN_RATE_LIMIT`                               | API | `10`                          | Failed sign-ins per IP and email per 15 minutes                                                                                                                 |
| `LOGIN_ACCOUNT_RATE_LIMIT`                       | API | `30`                          | Failed sign-ins per account per 15 minutes, whatever the IP. Stops IP-spoofing guessers, at the cost of a 15-minute lockout someone could trigger deliberately. |
| `API_RATE_LIMIT_PER_MINUTE`                      | API | `600`                         | Requests per minute per signed-in session (otherwise per IP)                                                                                                    |
| `TRUST_FORWARDED_FOR`                            | Web | unset                         | Set to `1` only behind an edge proxy that overwrites `X-Forwarded-For` (such as Vercel). Otherwise the header is removed.                                       |
| `SEED_MANAGER_PASSWORD` / `SEED_VIEWER_PASSWORD` | API | demo values in `.env.example` | Always required. With `NODE_ENV=production` the seed refuses the published demo passwords and anything shorter than 12 characters.                              |
