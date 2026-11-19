# ACME Salary Management Platform

ACME's HR team keeps salaries for 10,000 employees across several countries in Excel. This is a web app that replaces those spreadsheets. HR managers can maintain employee and salary records with a full audit trail, import and export their spreadsheets, and see how the organisation pays its people without mixing currencies.

## Submission at a glance

| What                    | Where                                                                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Live demo**           | **https://incubyte-acme-salary.vercel.app**. Sign in with the demo accounts below. Every record is synthetic. Hosted in US East (Vercel and Neon).                                                   |
| **Source**              | Private GitHub repository `Rohitmengji/Incubyte-acme-salary-platform`. Reviewers need to be invited.                                                                                                 |
| **CI**                  | GitHub Actions on every push: quality checks, the reviewer path on Ubuntu, macOS and Windows, and Playwright e2e. Latest results are in the [acceptance checklist](docs/acceptance-checklist.md#ci). |
| **Run it locally**      | [Reviewer quick start](#reviewer-quick-start). Only Node.js is needed; no Docker or PostgreSQL install.                                                                                              |
| **3-minute demo**       | [docs/demo-script.md](docs/demo-script.md)                                                                                                                                                           |
| **What's done and not** | [docs/acceptance-checklist.md](docs/acceptance-checklist.md)                                                                                                                                         |

**Built:**

- A Next.js 16 web app and an Express 5 API on PostgreSQL 18, holding exactly 10,000 synthetic employees from a deterministic seed.
- 234 automated unit, integration and component tests (the API's run against real PostgreSQL), plus 19 Playwright end-to-end tests with axe accessibility scans.

**Not delivered:** Docker files, by decision. See [Known limitations](#known-limitations-and-not-delivered).

## Reviewer quick start

The only prerequisite is **Node.js 24 or newer** (developed on Node 26 LTS; see `.nvmrc`). You **don't** need Docker or a PostgreSQL install: `npm run setup` downloads and runs a local PostgreSQL 18 through npm.

```bash
npm install
npm run setup   # creates apps/api/.env, starts local PostgreSQL on :54329, migrates, seeds 10,000 employees
npm run dev     # web app on http://localhost:3000 (API on :4000, reached through the web app)
```

Open **http://localhost:3000** and sign in. The same accounts work on the [live demo](https://incubyte-acme-salary.vercel.app). Locally, the passwords come from `apps/api/.env`:

| Role       | Email                     | Password             | Can                                                                                  |
| ---------- | ------------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| HR Manager | `hr.manager@acme.example` | `Manager-Demo-2026!` | Everything: create, edit, deactivate, change and correct salaries, import and export |
| HR Viewer  | `hr.viewer@acme.example`  | `Viewer-Demo-2026!`  | Read only (dashboard, employees, salary history, analytics)                          |

### Running the tests

```bash
npm test                          # unit + integration + component tests (API uses a separate acme_test database)
npx playwright install chromium   # once, to download the test browser
npm run test:e2e                  # browser journeys on an isolated acme_e2e database (ports 3100/4100)
npm run lint && npm run typecheck && npm run format:check
```

| Suite                           | Tests | Runs against                                                                   |
| ------------------------------- | ----- | ------------------------------------------------------------------------------ |
| `packages/shared` (unit)        | 24    | Pure functions: money, dates, request schemas                                  |
| `apps/api` (unit + integration) | 154   | Real PostgreSQL (`acme_test`), rebuilt from the migrations on each run         |
| `apps/web` (component)          | 56    | React Testing Library; the network is mocked at the `fetch` boundary           |
| `e2e` (Playwright)              | 19    | The full stack on an isolated `acme_e2e` database seeded with 10,000 employees |

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

**Using your own PostgreSQL instead.** Set `EMBEDDED_POSTGRES=0` and point `DATABASE_URL` and `TEST_DATABASE_URL` in `apps/api/.env` at your server. It must be **PostgreSQL 18 or newer**, because the schema uses `uuidv7()`. You'll need permission to create the `pg_trgm` and `btree_gist` extensions.

**Port conflicts.** If port 54329 is busy, set `LOCAL_PG_PORT` and update the URLs in `apps/api/.env` to match. The web app forwards `/api/*` to `API_ORIGIN` (default `http://localhost:4000`).

## Configuration

Every API setting is validated at startup (`apps/api/src/config.ts`), and the app refuses to start on an invalid value. `apps/api/.env.example` holds safe local defaults, and `npm run setup` copies it to `.env`.

| Variable                                         | App       | Default (local)               | Purpose                                                                                                                          |
| ------------------------------------------------ | --------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                   | API       | local `acme_dev`              | PostgreSQL 18+ connection string (required)                                                                                      |
| `TEST_DATABASE_URL`                              | API tests | local `acme_test`             | Integration-test database. The name must look like `*_test`, because it's rebuilt on every run.                                  |
| `EMBEDDED_POSTGRES` / `LOCAL_PG_PORT`            | scripts   | `1` / `54329`                 | Use the bundled local PostgreSQL, and on which port                                                                              |
| `NODE_ENV`                                       | API       | `development`                 | `production` forces `Secure` `__Host-` cookies and the seed's password guard                                                     |
| `PORT` / `HOST`                                  | API       | `4000` / `127.0.0.1`          | Where `npm start` / `npm run dev` listen. On Vercel the platform handles this.                                                   |
| `WEB_ORIGIN`                                     | API       | `http://localhost:3000`       | Browser origin(s) allowed to make state-changing requests (comma separated)                                                      |
| `TRUST_PROXY_HOPS`                               | API       | `1`                           | Reverse-proxy hops in front of the API (the Next.js rewrite counts as one)                                                       |
| `SESSION_TTL_HOURS` / `COOKIE_SECURE`            | API       | `8` / `false`                 | Session lifetime / force `Secure` cookies outside production                                                                     |
| `LOG_LEVEL`                                      | API       | `info`                        | pino log level                                                                                                                   |
| `LOGIN_RATE_LIMIT`                               | API       | `10`                          | Failed sign-ins per IP and email per 15 minutes                                                                                  |
| `LOGIN_ACCOUNT_RATE_LIMIT`                       | API       | `30`                          | Failed sign-ins per account per 15 minutes, whatever the IP                                                                      |
| `API_RATE_LIMIT_PER_MINUTE`                      | API       | `600`                         | Requests per minute per signed-in session (otherwise per IP)                                                                     |
| `SEED_MANAGER_PASSWORD` / `SEED_VIEWER_PASSWORD` | seed      | demo values in `.env.example` | Passwords of the two seeded users (required)                                                                                     |
| `SEED_EMPLOYEE_COUNT`                            | seed      | `10000`                       | Number of synthetic employees                                                                                                    |
| `ALLOW_DEMO_PASSWORDS`                           | seed      | unset                         | `1` lets a `NODE_ENV=production` seed use the published demo passwords, for a public demo on synthetic data only                 |
| `API_ORIGIN`                                     | Web       | `http://localhost:4000`       | Where `/api/*` is forwarded. It's read at **build** time for production builds.                                                  |
| `TRUST_FORWARDED_FOR`                            | Web       | unset                         | `1` keeps `X-Forwarded-For` on `/api/*`. Set it only behind an edge that overwrites the header; otherwise the header is removed. |
| `NEXT_DIST_DIR`                                  | Web       | `.next`                       | Build directory, so the e2e stack can run next to the dev server                                                                 |
| `E2E_DATABASE_URL`                               | e2e       | local `acme_e2e`              | The Playwright database. The name must start with `acme_e2e`.                                                                    |

## Deployment

The live demo runs as **two Vercel projects**, the web app and the API (as one Vercel Function), with **Neon Postgres 18** from the Vercel Marketplace in the same region. The browser only ever talks to the web app's origin, so the session cookie stays first-party.

- **Runbook:** [docs/deployment.md](docs/deployment.md) has every setting, the exact commands used, what was verified on the live site, and the problems hit along the way.
- **Why this design:** [ADR-0006](docs/adr/0006-deploy-on-vercel-with-neon.md).
- **Migrations and seed in production:** `prisma migrate deploy`, then the normal seed with `NODE_ENV=production`, both over the database's direct connection. The seed refuses the demo passwords unless `ALLOW_DEMO_PASSWORDS=1` is set, and that's only appropriate for a public demo on synthetic data.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

1. **Quality:** `format:check`, `lint`, `typecheck` and unit tests.
2. **Reviewer path** on `ubuntu-latest`, `macos-latest` and `windows-latest`. Each job does exactly what a reviewer would: `npm ci`, `npm run setup` (embedded PostgreSQL, migrations, 10k seed), the integration tests, and `npm run build`.
3. **End to end:** `npm run setup`, then the Playwright suite. The report is uploaded if it fails.

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
| [docs/deployment.md](docs/deployment.md)                                   | Live deployment runbook and verification            |
| [docs/demo-script.md](docs/demo-script.md)                                 | 3-minute product demonstration                      |
| [docs/acceptance-checklist.md](docs/acceptance-checklist.md)               | What's done, with evidence, and what's outstanding  |
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

The settings that matter outside a laptop (bind address, login and API rate limits, forwarded headers, seed passwords) are listed under [Configuration](#configuration).

## Known limitations and not delivered

- **Docker / Docker Compose: not delivered**, by decision. Local setup needs only Node.js, and any PostgreSQL 18 server works through `DATABASE_URL`.
- **Live demo latency:** it's hosted in US East. From India, a request takes about 0.3 s, mostly network ([performance](docs/performance.md#live-deployment-vercel--neon)).
- **Rate limits live in memory, per process or function instance.** A multi-instance production deployment needs a shared store.
- **The live demo uses the published demo passwords and is shared.** Reviewers' changes persist until the database is reset ([how](docs/deployment.md#resetting-the-demo-data)).
- **Out of scope by design:** payroll, tax, SSO and MFA, live FX rates, approvals, and a user-management UI ([requirements](docs/requirements.md#out-of-scope-deliberately)).

Everything else, with evidence, is in the [acceptance checklist](docs/acceptance-checklist.md).
