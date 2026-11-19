# ADR-0003: Model salary history as an effective-dated timeline that the database protects

**Status:** Accepted · 2026-11-19

## Context

HR needs a current salary, a full history, changes with effective dates (including future-dated raises), corrections to mistakes, and an audit trail. The brief requires that "invalid or overlapping effective salary periods" are prevented.

Two HR managers can edit the same employee at the same moment. If the rules only lived in application code, two requests could both read the timeline before either wrote to it, and both would pass validation.

## Decision

- **One period per row.** Each `compensation` row covers `[effective_from, effective_to)`. The end date is exclusive, and `effective_to IS NULL` means the period is open-ended. The current salary is the row that contains today's date (UTC). No row stores an "is current" flag.
- **Changes can go anywhere in the timeline.** In a single transaction the service:
  1. locks the employee row (`SELECT … FOR UPDATE`);
  2. loads the periods before and after the new date;
  3. ends the previous period at the new `effective_from`;
  4. ends the new period at the next period's `effective_from`, or leaves it open;
  5. inserts the new row;
  6. writes an audit row.
- **Rules.** These are pure functions, written test-first:
  - `effective_from` is on or after the hire date.
  - `effective_from` doesn't equal an existing period's start date. That case should use a correction instead.
  - The employee isn't `INACTIVE`.
  - The amount is greater than 0 and has a valid number of decimal places for its currency.
  - A reason is required.
- **Corrections:**
  - Corrections can change amount, currency, reason and note, and must send the `version` they read. A stale version returns 409.
  - `effective_from` can only move strictly between the neighbouring periods' start dates, and never before the hire date. Under the same employee lock, the **previous period's `effective_to` is moved to match**, so a correction creates neither an overlap (which the database would reject) nor a gap (which the database can't detect).
  - Every changed row has its `version` incremented and its own audit entry.
- **No gaps and no deletes.** Salary rows are **never deleted**, and no gaps are left between periods.
- **Deactivation.**
  - Deactivation records a termination date and blocks new salary periods. Existing periods are left as they are, because analytics decide who is employed from hire and termination dates, not from open periods.
  - Reactivation only **undoes a mistaken deactivation**. Rehires would need employment intervals and are out of scope.
- **Database backstops.** These are written as custom SQL in the Prisma migration:
  - `EXCLUDE USING gist (employee_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&) DEFERRABLE INITIALLY DEFERRED`, which needs `btree_gist`. Making it deferred lets the neighbour updates inside one transaction pass through a temporary overlap; the check runs at commit.
  - `UNIQUE (employee_id, effective_from)`, `CHECK (amount > 0)` and `CHECK (effective_to IS NULL OR effective_to > effective_from)`.
  - A violation is reported to the client as `409 Conflict`.

## Alternatives considered

- **Store only `effective_from` and derive the end with `LEAD()`.** There'd be no database-level overlap guarantee, and every "current salary" query would need a window function.
- **An `is_current` flag, or a current-salary column on `employee`.** Either one goes stale as soon as a future-dated change takes effect, unless a scheduled job updates it.
- **Event sourcing or temporal tables.** Too heavy for this scope, and a lot to explain in an assessment.
- **Validating only in the application.** Two concurrent requests could both pass and create overlapping periods.

## Consequences

- **Gains:** overlaps can't happen even with a bug or a race. "As of a date" queries are simple and can use indexes. History is complete and auditable.
- **Costs:**
  - `effective_to` is derived data that the service has to keep in step.
  - Prisma can't express exclusion constraints or triggers, and its drift check ignores them, so a clean `prisma migrate diff` proves nothing about them. They live in custom migration SQL and are guarded by tests that check PostgreSQL's catalog and the actual behaviour.
  - Because the constraint is deferred, a violation only shows up at `COMMIT`, and error mapping has to handle that.
- **Not solved:** approval workflows, retroactive pay calculations and bulk salary-review cycles.
- **Revisit if:** compensation gains extra components such as bonus or allowances. They'd need their own timelines.
