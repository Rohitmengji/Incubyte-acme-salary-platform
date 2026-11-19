# Implementation plan

Each phase leaves the repository working and verifiable, and ends with one or more Conventional Commits. Nothing is pushed to a remote without Rohit's go-ahead. The dependency order is: tooling, then data, then API, then UI, then end-to-end tests and delivery. The enabling work comes first because everything else depends on it.

## Decisions settled before coding

- **Repository layout:** npm workspaces (`apps/api`, `apps/web`, `packages/shared`).
- **Data model and integrity rules:** see [architecture.md §5](./architecture.md#5-data-model).
- **Auth:** same-origin cookie sessions ([ADR-0001](./adr/0001-same-origin-api-and-cookie-sessions.md)).
- **Money:** handled as described in [ADR-0002](./adr/0002-money-and-multi-currency-analytics.md).
- **Salary timeline:** [ADR-0003](./adr/0003-salary-history-as-db-guarded-timeline.md).
- **Analytics:** computed in SQL ([ADR-0004](./adr/0004-analytics-in-sql-without-cache.md)).
- **Local database and tests:** embedded PostgreSQL locally, Docker verified in CI ([ADR-0005](./adr/0005-zero-install-postgres-and-real-database-tests.md)).
- **Reviewer path:** running locally is the primary way to review. Vercel with Neon is a secondary deliverable.

## Phases

| # | Phase | Main deliverables | Verification (must pass before commit) | Commit(s) |
|---|---|---|---|---|
| 0–1 | Discovery and design | Requirements, architecture, 5 ADRs, this plan, AI log | Rohit reviews | `docs: …` |
| 2 | Workspace and tooling | npm workspaces, TS strict configs, ESLint + Prettier, Vitest wiring, embedded-postgres scripts (`setup`, `db:start`, `db:stop`, `db:reset`), `.env.example`, API `GET /health`, Next.js shell page, CI workflow (lint, typecheck, test) | `npm run lint`, `typecheck` and `test` are green. `npm run setup` starts PostgreSQL on this Mac. `/health` returns 200. The web app renders. The CI reviewer-path job (Ubuntu, macOS, Windows: clean `npm ci` then `npm run setup`) is defined. | `chore: initialize full stack workspace` · `ci: configure GitHub Actions` |
| 3 | Schema, migrations, seed | Prisma schema. Custom SQL for `btree_gist`, `pg_trgm`, the exclusion constraint, CHECKs and the append-only audit trigger. A deterministic seed: exactly 10,000 employees, 8 countries, 7 currencies including JPY, salary history for a subset, an FX snapshot, an `HR_MANAGER` and an `HR_VIEWER` user. | Migrating an empty database succeeds. `prisma migrate diff` shows no drift for the parts Prisma models. **Catalog checks** (`pg_constraint`, `pg_trigger`, `pg_extension`) prove the custom protections exist. Behaviour tests show an overlap is rejected at commit and `UPDATE`/`DELETE` on `audit_log` is rejected. Seeding twice still gives exactly 10,000 employees and identical checksums. Seed time is recorded. | `feat(db): add schema, constraints and migrations` · `feat(db): add deterministic 10k employee seed` |
| 4 | API foundation and auth | Config validated with Zod. Request ID, pino logging with redaction, problem+json errors, validation middleware. Login, logout and current-user endpoints with Argon2id and a session table. Rate limiting, origin check, role middleware, helmet, CORS, `no-store`. | Integration tests: login succeeds and fails with a generic message; rate limit returns 429; 401 without a session; 403 for the wrong role; expired and revoked sessions are rejected; cross-origin POST is rejected. | `feat(api): add auth, sessions and RBAC` |
| 5 | Employees API | Reference data. List with search, filters, sort and pagination. Get, create (with initial salary, in one transaction), edit (with `version`, and `hire_date` no later than the first salary period), deactivate and undo deactivation, all audited. | Integration tests: each filter and filter combinations, sort order and tiebreak, page bounds, `%` and `_` in search, duplicate ID or email returns 409, stale version returns 409, an audit row is written in the same transaction. | `feat(api): implement employee management endpoints` |
| 6 | Salary API (TDD) | Domain timeline rules written test-first. History, add change (insert anywhere in the timeline), correction, audit trail endpoint. | Unit tests: every timeline rule and edge case (before hire date, same date as an existing period, future-dated, insert between periods, decimal places per currency, a correction moving a start date earlier or later also moves the previous period's end, with no gap and no overlap). Integration tests: concurrent changes for the same employee never overlap, rollback leaves no partial rows, every changed row is versioned and audited, an inactive employee can't get a new period. | `test: add compensation timeline rules` · `feat(api): add compensation history and audit logging` |
| 7 | Analytics API | Summary, distribution (by country, department or job title; local or normalised currency), histogram, trends, recent changes (taken from audit events). | Hand-computed fixture tests for min, max, average and an **exact median** (odd and even group sizes, large fractional amounts), plus n, both per currency and normalised. Each population tested separately: records, employed headcount and salary population. In trends, a person who has since left is still counted in the months they worked. Small-sample flag. `EXPLAIN ANALYZE` against the seed, recorded in `performance.md`. | `feat(api): add salary analytics` |
| 8 | CSV import and export | Parse, validate and preview a batch; idempotent atomic commit; streamed export with formula escaping and an audit row. | Unit tests: row validation, BOM and CRLF, thousands separators, formula escaping. Integration tests: preview counts, double commit, conflict at commit time rolls back, size and row limits return 413 or 400, `HR_VIEWER` gets 403. | `feat(api): add CSV import preview, commit and export` |
| 9 | Web foundation | Design tokens, shadcn primitives, app shell (sidebar, top bar, skip link), login page, route guard, typed API client, shared states for loading, empty and error. | Component tests for the login form's validation and error messages. Playwright smoke test: login and logout. Keyboard walk-through. | `feat(web): add design system, shell and login` |
| 10 | Employee and salary UI | Employee table with filters, search and sort kept in the URL. Profile page, create and edit forms, deactivate dialog, salary history timeline, salary change and correction forms, 409 handling. | Component tests: table sort and filter update the URL and query; debounce; form validation; disabled button while a request is pending; 409 message. | `feat(web): implement employee management interface` · `feat(web): add salary history and editing` |
| 11 | Dashboard and analytics UI | KPI cards per currency, a toggle for normalised view with the snapshot label, charts with a table view, small-sample badges. | Component tests: loading, empty and error states; currency mode toggle. Manual check of the responsive layout. | `feat(web): build HR dashboard` · `feat(web): add salary analytics` |
| 12 | Import and export UI | Upload, preview table with row errors, confirm dialog, export of the filtered list. | Component tests for the preview and confirm flow. | `feat(web): add CSV import and export` |
| 13 | End-to-end tests and accessibility | Playwright specs for the five journeys, axe scans, mobile viewport runs. | `npm run test:e2e` is green locally and in CI. | `test(e2e): cover critical HR journeys` |
| 14 | Docker and the full CI pipeline | Dockerfiles (multi-stage, non-root), `docker-compose.yml`, CI jobs for the reviewer path on 3 operating systems, e2e, Docker build and a compose smoke test. | The CI run is green. This needs Rohit's approval to push. | `build: add Docker and compose` · `ci: add integration, e2e and docker jobs` |
| 15 | Delivery | README with a quick start for reviewers, `performance.md` with real measurements, `demo-script.md`, finished AI log. Vercel and Neon deployment, which needs Rohit's accounts. | Follow the README from a clean clone. Check the deployed URL by hand. | `docs: …` · `chore(deploy): …` |

## Explicit non-goals

Payroll, tax, bank payments, bonus and equity, SSO and MFA, live FX, multi-tenancy, approval workflows, a user-management UI, and deleting salary records. The reasons are in [requirements.md](./requirements.md#out-of-scope-deliberately).

## What could go wrong, and the fallback

| Risk | Fallback |
|---|---|
| embedded-postgres fails on some platform | Docker Compose, or any `DATABASE_URL` |
| Prisma drift on the custom constraints | Keep the custom SQL in one dedicated migration, and check PostgreSQL's catalog in the integration suite (Prisma's own drift check can't see these objects) |
| The Express API doesn't run well as a Vercel Function | Host the API on Render or Railway and keep the same-origin rewrite from the Vercel web app |
| Serverless rate limiting is per instance | Use a rate-limit store backed by Postgres |
