# AI development log

This log records how AI assistance (GitHub Copilot agent mode) was used on this project: the prompts, what was accepted, what was rejected or corrected after review, and why. It covers only what actually happened.

---

## Phases 0–1: discovery, requirements and design (2026-11-19)

### Prompt

Rohit gave a detailed brief covering the business context, engineering principles, stack, modules, data and security expectations, testing, seeding, scope control and a phased plan. Its instruction for this step was: *"complete PHASE 0 and PHASE 1 only… present the requirements document, proposed architecture, assumptions, and implementation plan. Then wait."*

Rohit then gave two clarifications:

1. **Git identity.** Use the `rohitmengjih@gmail.com` GitHub account, not the work account.
2. **Setup choices.** The AI asked a short structured question. Rohit answered:
   - Repo name: "you decide".
   - Database: don't install Docker. Use embedded PostgreSQL locally, with Docker verified in CI.
   - Deployment: *"let them run, test and review the application locally; write it in the README for the interviewer"*. "Vercel is fine" as the deployment target.

### Discovery: what the AI checked rather than assumed

| Check | Finding | Effect on the design |
|---|---|---|
| Workspace | The folder isn't a git repo. It holds unrelated projects and no existing salary work. | Created a fresh `acme-salary-platform/` repo, with no risk of overwriting anything |
| Git identity | Global git identity unset. The `gh` CLI is signed in as `Rohitmengji`, whose verified primary email is `rohitmengjih@gmail.com`. | Set `user.name` and `user.email` in the **repo-local** config only |
| Toolchain | Node 26.13 (an LTS line), npm 11. No Docker, PostgreSQL, Homebrew, pnpm or Corepack. | npm workspaces. embedded-postgres for local development. Docker verified in CI. |
| npm `latest` tags | `prisma@latest` is **8.0.0-rc.34** (a release candidate). `typescript@latest` is 7.0.2, but typescript-eslint supports `<6.1`. `@tanstack/react-table@latest` is 9.x, stable only since Aug 2026. | Pinned Prisma 7.10, TypeScript 5.9 and TanStack Table 8.21. A blind `npm install` would have pulled an RC ORM and an unsupported compiler. |
| Spike: embedded PostgreSQL on this Mac | PostgreSQL 18.6 (arm64) started in about 6 s. The `btree_gist` exclusion constraint on `uuid` + `daterange` works with `DEFERRABLE INITIALLY DEFERRED`. A temporary overlap inside a transaction commits, an overlap left at commit is rejected (`23P01`), and the CHECKs reject invalid rows. | [ADR-0003](./adr/0003-salary-history-as-db-guarded-timeline.md) and [ADR-0005](./adr/0005-zero-install-postgres-and-real-database-tests.md) rest on verified behaviour, not on memory |
| Spike: median type | `percentile_cont` returns **double precision** even for `NUMERIC` input. `percentile_disc` and `avg` keep `NUMERIC`. | **Design corrected:** the median is computed exactly from the two middle rows, and quartiles use `percentile_disc`. The first draft of the architecture would have put float maths into money analytics. |
| Spike: rounding | `round(numeric)` rounds half away from zero (`2.345` gives `2.35`, `-2.345` gives `-2.35`) | The rounding rule is documented in ADR-0002 |
| Mermaid diagrams | All 4 diagrams parse with mermaid 11.17. A deliberately broken diagram was rejected, so the check itself works. | Diagrams will render on GitHub |

### Why AI help was useful here

- Building the first draft of a requirements document, ERD, sequence diagrams and ADRs quickly, from a long brief.
- Running registry and toolchain checks and a database spike before committing to the design, instead of relying on recalled facts.

### Decisions made after reviewing AI output

- **Same-origin API proxy ([ADR-0001](./adr/0001-same-origin-api-and-cookie-sessions.md)).** Cross-origin cookie auth between a Vercel web app and a separate API would break under third-party cookie blocking. Calling this out early avoided a late deployment surprise.
- **Pinned dependency versions.** Prisma 7.10, TypeScript 5.9 and TanStack Table 8.21, as described above.
- **CSV upload limit of 4 MB.** It's under Vercel's 4.5 MB request-body cap, so the deployment target is a constraint on the design.
- **Employee ID is supplied by HR, not generated.** It matches existing spreadsheets and makes double submits fail safely with a 409.

### Independent review

An independent design review (a separate AI agent working only from the docs, which couldn't edit anything) was run on the requirements, architecture, ADRs and plan before committing. Every finding was checked against the docs before it was accepted.

| # | Severity | Finding | Accepted? | Correction |
|---|---|---|---|---|
| 1 | High | Corrections that move a period's start had no rule for the previous period's end. Moving the start later leaves a gap, which the exclusion constraint can't detect. Moving it earlier causes an overlap. | Yes | ADR-0003 and architecture §6: the previous period's `effective_to` moves in the same locked transaction, and every changed row is versioned and audited. New unit-test cases were added to Phase 6. |
| 2 | High | Trends used today's `ACTIVE` status, which drops people who have since left from months when they were employed. A reactivate action can't be modelled with a single termination date. | Yes | Each trend point now works out who was employed at that date from hire and termination dates. Reactivate is narrowed to undoing a mistaken deactivation. Rehire and history of department or title changes are now explicitly out of scope, and dimension trends are labelled "by current organisation". |
| 3 | Medium | `percentile_cont` breaks the exact-decimal promise | Yes, already found by the spike | Exact median from the two middle rows |
| 4 | Medium | "Headcount = active only" contradicts the required status breakdown, which includes inactive employees | Yes | Three named populations: records, employed headcount and salary population |
| 5 | Medium | `prisma migrate diff` ignores exclusion constraints and triggers, so a clean diff proves nothing about them | Yes | Checks against PostgreSQL's catalog plus behaviour tests, run after every migration |
| 6 | Medium | CI with a Postgres service container never tests the reviewer's actual setup (embedded PostgreSQL) | Yes | CI reviewer-path job: clean `npm ci` then `npm run setup` on Ubuntu, macOS and Windows |
| 7 | Medium | A "recent changes" feed ordered by `compensation.created_at` misses corrections | Yes | The feed comes from audit events, indexed on `audit_log (entity_type, occurred_at DESC)` |

The reviewer also confirmed the PostgreSQL facts the design relies on: `btree_gist` supports `uuid`, deferred exclusion constraints are allowed, and a NULL upper bound on a `daterange` means unbounded. This matched the spike.

**Lesson for later phases:** the two high-severity issues were both about *time*: how history changes when someone edits it, and how today's state can distort past reporting. Every later phase that touches dates will get explicit "what happens to history" test cases.
