# ACME Salary Management Platform

ACME's HR team keeps salaries for 10,000 employees across several countries in Excel. This is a web app that replaces those spreadsheets. HR managers can maintain employee and salary records with a full audit trail, and see how the organisation pays its people, without mixing currencies.

> **Status: Phase 1 (requirements and design).** No application code exists yet. Everything below describes the planned design. Nothing here is claimed to work until it has been built and verified, phase by phase.

## Documentation

| Document | Purpose |
|---|---|
| [docs/requirements.md](docs/requirements.md) | One-page requirements: problem, persona, functional and non-functional requirements, scope, assumptions |
| [docs/architecture.md](docs/architecture.md) | System design, data model (ERD), key flows, API surface, security model, testing strategy, environments |
| [docs/adr/](docs/adr/) | Architecture decision records: sessions, money, salary timeline, analytics, local database |
| [docs/implementation-plan.md](docs/implementation-plan.md) | Phased delivery plan, with verification and commits for each phase |
| [docs/ai-development-log.md](docs/ai-development-log.md) | How AI assistance was used, reviewed and corrected |

## Planned stack

| Layer | Technologies |
|---|---|
| Web | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, shadcn/ui, TanStack Query and Table, Recharts, React Hook Form + Zod |
| API | Express 5, TypeScript, Zod, Prisma 7 |
| Database | PostgreSQL 18 |
| Tests | Vitest, React Testing Library, Supertest, Playwright |
| Delivery | Docker Compose, GitHub Actions |

## Reviewer quick start (target, not yet implemented)

The goal is that an interviewer can run, test and review the whole app locally with **only Node.js 26 LTS installed**. No Docker and no separate PostgreSQL install are needed. The planned commands are:

```bash
npm install
npm run setup   # start embedded PostgreSQL, migrate, seed 10,000 synthetic employees
npm run dev     # web on http://localhost:3000, API on http://localhost:4000
npm test        # unit + integration tests
```

Docker Compose will also be provided. The demo credentials, the full instructions and the deployed URL will be added here once they've been verified.
