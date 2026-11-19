# ADR-0005: Run PostgreSQL locally with nothing to install, and test against a real database

**Status:** Accepted · 2026-11-19 · Amended 2026-11-19: Docker Compose dropped (see the end of this ADR)

## Context

Interviewers must be able to run, test and review the app on their own machines with as little setup as possible. Docker can't be assumed. It isn't installed on the development machine either, and Homebrew isn't available there.

The riskiest behaviour in this app lives in PostgreSQL: the exclusion constraint, `NUMERIC` maths and medians, window functions and transaction semantics. A mocked database or a substitute engine would hide exactly the bugs that matter.

## Decision

- **Default local database:** the `embedded-postgres` npm package, which ships PostgreSQL 18 binaries for macOS, Linux and Windows. The exact version is pinned.
  - `npm run setup` starts it on port **54329**, so it won't clash with an existing Postgres. Data is stored in `.data/`, which is git-ignored. Setup then creates the `acme_dev` and `acme_test` databases, runs migrations and seeds.
  - `npm run dev` starts the database if it isn't already running.
- **Same code everywhere.** All code reads `DATABASE_URL`, so any PostgreSQL 18 server, Neon included, works without code changes. CI runs the reviewer path itself (clean install, `npm run setup` on embedded PostgreSQL, integration tests) on Ubuntu, macOS and Windows. That way the setup interviewers will use is tested, not just a service container.
- **Integration tests use real PostgreSQL** with a dedicated test database. Tables are truncated between tests, and test files run one at a time until measurements justify running them in parallel. There are **no ORM or database mocks**. Pure business logic gets fast unit tests instead.

## Alternatives considered

- **Docker only.** Leaves out reviewers who don't have Docker, including the development machine.
- **SQLite for development and tests.** It doesn't support exclusion constraints or ordered-set aggregates, and its decimal semantics differ. The tests would pass while production failed.
- **Testcontainers.** Needs Docker.
- **pg-mem.** An incomplete emulation of PostgreSQL that doesn't support GiST exclusion constraints.
- **A shared hosted database for reviewers.** It would mean sharing credentials, needing network access and having tests interfere with each other.

## Consequences

- **Gains:** Node 26 and `npm install` are the only things to install. The tests exercise the real constraints and SQL.
- **Costs:**
  - The first install downloads a platform-specific PostgreSQL binary of tens of MB.
  - Upstream labels the package versions beta, so it's pinned exactly. The fallback is any PostgreSQL 18 server (`EMBEDDED_POSTGRES=0` plus `DATABASE_URL`).
  - Windows needed a fix: `pg_ctl start` hung under `spawnSync` with piped output, because the server inherits the pipes. It now runs without pipes, and CI covers Windows.
  - Running test files serially makes the suite slower. That's accepted until it's measured.
- **Revisit if:** embedded-postgres fails on a reviewer's platform, or the integration suite gets slow enough to need a database per worker.

## Amendment (2026-11-19): no Docker Compose

The original decision also promised a Docker Compose alternative, verified in CI. The candidate decided not to deliver Docker, so no Docker files exist, and the [acceptance checklist](../acceptance-checklist.md) records it as not delivered. The local reviewer path doesn't depend on Docker, and the live demo runs on Vercel and Neon ([ADR-0006](./0006-deploy-on-vercel-with-neon.md)).
