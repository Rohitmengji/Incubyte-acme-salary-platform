# ADR-0002: Store money as decimals and never add amounts in different currencies

**Status:** Accepted · 2026-11-19

## Context

ACME pays 10,000 employees in about seven currencies. Those currencies have different minor units: JPY has 0 and USD has 2.

JavaScript `number` is a binary float, so `0.1 + 0.2 !== 0.3`. Adding INR and USD salaries into one "average salary" gives a number that is wrong and misleading. The brief explicitly forbids it.

Even so, HR leadership still wants a single company-wide view, for example "which department is paid most?" across countries.

## Decision

- **Storage.** `compensation.amount` is `NUMERIC(19,4)` and has a foreign key to `currency(code)`. Each currency row stores its `minor_units`. The API rejects amounts that are ≤ 0 or have more decimal places than the currency allows.
- **Transport.** Money is always sent as `{ "amount": "125000.00", "currency": "USD" }`, with the amount as a decimal **string**. It's never a JSON number. The shared Zod schemas enforce this.
- **Arithmetic.**
  - Aggregates run in SQL on `NUMERIC`, never through `double precision` functions such as `percentile_cont`. `round()` rounds halves away from zero.
  - Server code uses Prisma's `Decimal` type.
  - The web app does **no arithmetic on money**. It only formats strings with `Intl.NumberFormat`, which accepts decimal strings without converting them to floats.
- **Analytics.**
  - **Local mode (the default)** groups every statistic by currency, so different currencies are never mixed.
  - **Normalised mode** converts to the reporting currency (USD) using a dated `exchange_rate` snapshot (`rate_to_reporting`, `as_of_date`, `source`). Rounding to the reporting currency's minor units happens once, at the end. Every normalised figure shows its snapshot date.
- **FX data.** The FX snapshot is seeded, clearly labelled illustrative, and only for reporting. There's no live FX feed.

## Alternatives considered

- **Integer minor units (`BIGINT` cents).** A solid, common choice. It was rejected because currencies have different minor units, and averages and medians would need conversions to and from minor units in every analytics query. `NUMERIC` is just as exact and keeps the SQL readable.
- **`double precision` or JS numbers.** Rounding errors in financial data.
- **Converting to USD when salaries are saved.** Freezes one day's FX rate into the payroll record and hides the real pay currency. Changing the snapshot would also rewrite history.
- **A live FX API.** Out of scope. It also makes tests non-deterministic and adds an external dependency.

## Consequences

- **Gains:** exact maths, analytics that don't mislead, and a single place where conversion happens.
- **Costs:** the UI has to show a currency next to every amount. The normalised view depends on which snapshot is chosen, so it has to be labelled. Developers have to remember that money is always a string in DTOs (enforced by schema tests).
- **Not solved:** FX rates that are accurate for each period. Trends use one snapshot for all months, and the UI says so.
- **Revisit if:** finance needs period-accurate FX, or totals for payroll cost and accruals.
