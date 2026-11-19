# ACME Salary Management Platform

ACME's HR team keeps salaries for 10,000 employees across several countries in Excel. This is a web app that replaces those spreadsheets. HR managers can maintain employee and salary records with a full audit trail, and see how the organisation pays its people, without mixing currencies.

> **Status: the backend foundation is built and verified. The frontend hasn't been started yet.**
>
> **Working now:**
>
> - Authentication with sessions and roles
> - Employee and salary APIs, with audit logging
> - Migrations, and a deterministic seed of exactly 10,000 synthetic employees
> - 126 automated tests
>
> **Still to build:** analytics endpoints, CSV import and export, the Next.js web app, Docker, and deployment. See the [implementation plan](docs/implementation-plan.md).

## Reviewer quick start

The only prerequisite is **Node.js 24 or newer** (developed on Node 26 LTS; see `.nvmrc`). You **don't** need Docker or a PostgreSQL install: `npm run setup` downloads and runs a local PostgreSQL 18 through npm.

```bash
npm install
npm run setup   # creates apps/api/.env, starts local PostgreSQL on :54329, migrates, seeds 10,000 employees
npm run dev     # API on http://localhost:4000 (restarts on file changes)
npm test        # all unit + integration tests (uses a separate acme_test database)
```

**Demo accounts** (local development only; the passwords come from `apps/api/.env`):

| Role       | Email                     | Password             | Can                                             |
| ---------- | ------------------------- | -------------------- | ----------------------------------------------- |
| HR Manager | `hr.manager@acme.example` | `Manager-Demo-2026!` | read, create, edit, deactivate, change salaries |
| HR Viewer  | `hr.viewer@acme.example`  | `Viewer-Demo-2026!`  | read only                                       |

### Try the API with curl

```bash
# Sign in (stores the HttpOnly session cookie in cookies.txt)
curl -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"email":"hr.manager@acme.example","password":"Manager-Demo-2026!"}' \
  http://localhost:4000/api/v1/auth/login

# Search, filter, sort and paginate on the server
curl -b cookies.txt 'http://localhost:4000/api/v1/employees?search=sharma&country=IN&sort=hireDate&order=desc&page=1&pageSize=25'

# Salary history for one employee (use an id from the list above)
curl -b cookies.txt http://localhost:4000/api/v1/employees/<id>/compensations
```

## Commands

| Command                                                       | What it does                                                                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run setup`                                               | Idempotent. Starts the local DB, applies migrations and seeds. Safe to run repeatedly.                                                                 |
| `npm run dev`                                                 | Starts the local DB if needed, then the API in watch mode                                                                                              |
| `npm test` / `npm run test:unit` / `npm run test:integration` | Tests. Integration tests rebuild the `acme_test` database from the migrations.                                                                         |
| `npm run lint` / `npm run typecheck` / `npm run format:check` | Static checks                                                                                                                                          |
| `npm run build` then `npm start -w @acme/api`                 | Production bundle (`apps/api/dist/server.js`)                                                                                                          |
| `npm run db:start` / `npm run db:stop`                        | Start or stop the local PostgreSQL (data lives in `.data/`, which is git-ignored)                                                                      |
| `npm run db:reset`                                            | Drops and rebuilds the **local** dev database and re-seeds exactly 10,000 employees. Refuses to run against anything except the local embedded server. |

**Using your own PostgreSQL instead.** Set `EMBEDDED_POSTGRES=0` and point `DATABASE_URL` and `TEST_DATABASE_URL` at your server (PostgreSQL 16+). You'll need permission to create the `pg_trgm` and `btree_gist` extensions.

**Port conflicts.** If port 54329 is busy, set `LOCAL_PG_PORT` and update the two URLs in `apps/api/.env` to match.

## API overview (`/api/v1`)

All responses are JSON. Errors use [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json` and include a `requestId`. Money is always a decimal **string** plus a currency, for example `{"amount": "1800000.00", "currency": "INR"}`.

| Method and path                                           | Purpose                                                                                                                                                                                                           | Role               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` | Session lifecycle. Login is rate-limited.                                                                                                                                                                         | public / any / any |
| `GET /reference-data`                                     | Countries, currencies, departments, job titles, statuses, reasons                                                                                                                                                 | viewer+            |
| `GET /employees`                                          | `search`, `country`, `department`, `jobTitle`, `status` (repeat or comma-separate), `sort` (`name`, `employeeCode`, `hireDate`, `country`, `department`, `jobTitle`, `status`), `order`, `page`, `pageSize` ≤ 100 | viewer+            |
| `POST /employees`                                         | Create an employee and their initial salary in one transaction                                                                                                                                                    | manager            |
| `GET /employees/{id}` · `PATCH /employees/{id}`           | Detail with current salary / edit (send `version`)                                                                                                                                                                | viewer+ / manager  |
| `POST /employees/{id}/deactivate` · `/reactivate`         | Deactivate with a termination date and reason / undo a mistaken deactivation                                                                                                                                      | manager            |
| `GET /employees/{id}/audit-events`                        | Paginated audit trail for the employee                                                                                                                                                                            | viewer+            |
| `GET /employees/{id}/compensations`                       | Salary history, newest first, with `isCurrent`                                                                                                                                                                    | viewer+            |
| `POST /employees/{id}/compensations`                      | Add a salary change effective on any date, including future dates                                                                                                                                                 | manager            |
| `PATCH /employees/{id}/compensations/{compensationId}`    | Correct a record (send `version` and `correctionReason`)                                                                                                                                                          | manager            |
| `GET /health`                                             | Liveness plus database check                                                                                                                                                                                      | public             |

## Repository layout

```text
apps/api/            Express 5 API, Prisma schema, migrations, seed, tests
  src/domain/        pure business rules (salary timeline)
  src/http/          errors, problem+json handler, validation, security middleware
  src/modules/       auth · employees · compensation · audit · reference
  prisma/            schema, migrations (including custom integrity SQL), deterministic seed
  scripts/           local PostgreSQL manager, setup, build
  test/unit/         fast tests with no database
  test/integration/  HTTP + real PostgreSQL tests
packages/shared/     Zod request schemas, DTO types, money and date rules shared with the future web app
docs/                requirements, architecture, ADRs, plan, performance, AI log
```

## Documentation

| Document                                                   | Purpose                                             |
| ---------------------------------------------------------- | --------------------------------------------------- |
| [docs/requirements.md](docs/requirements.md)               | One-page requirements                               |
| [docs/architecture.md](docs/architecture.md)               | System design, data model, flows, security, testing |
| [docs/adr/](docs/adr/)                                     | Architecture decision records                       |
| [docs/implementation-plan.md](docs/implementation-plan.md) | Phased plan and current status                      |
| [docs/performance.md](docs/performance.md)                 | Measured seed time, API latency and query plans     |
| [docs/ai-development-log.md](docs/ai-development-log.md)   | How AI assistance was used, checked and corrected   |

## Security note

The app follows a reasonable security baseline for an assessment. That includes Argon2id passwords, HttpOnly session cookies, role checks on every route, rate limiting, origin checks, an append-only audit trail and synthetic data only. It is **not** certified as production-compliant. See [architecture §10](docs/architecture.md#10-security-model).
