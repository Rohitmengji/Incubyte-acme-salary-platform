# 3-minute product demonstration

**Where:** the live demo at **https://incubyte-acme-salary.vercel.app**, or a local run (`npm run setup && npm run dev`, then http://localhost:3000). The screens and data are the same.

**Before you start:**

- **Window:** use a 1440 px wide browser window at 100% zoom, with a fresh session.
- **Accounts:** HR Manager `hr.manager@acme.example` / `Manager-Demo-2026!`, and HR Viewer `hr.viewer@acme.example` / `Viewer-Demo-2026!`.
- **Import file:** have [`docs/demo/demo-import.csv`](./demo/demo-import.csv) ready. It holds 3 valid rows, 1 invalid row (salary `abc`) and 1 duplicate (`EMP-000001`).
- **The live demo is shared.** Changes made in a demo stay there.
  - Pick an employee and an effective date that haven't been used before. The app rejects a second salary change on the same date for the same person, which is correct behaviour but costs time on stage.
  - If the CSV has already been imported once, its three new rows show as duplicates. Edit the `DEMO-000x` IDs and emails first.
- **Latency:** the live site runs in US East, so expect about 0.3–0.6 s per action from India. A local run is instant.

| Time      | Show                                                                                                                                                                                                                                                                                                   | Say                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:15 | The sign-in page                                                                                                                                                                                                                                                                                       | "ACME's HR team keeps 10,000 salaries across eight countries in Excel. That means no history, no audit trail, and no honest answer to 'how do we pay people?'. This replaces the spreadsheet."                      |
| 0:15–0:40 | Sign in as the **HR Manager**. On the **Dashboard**, point at: 10,000 records by status, employed headcount, the USD median with its dated FX-snapshot label, _Pay by currency_ rows (never summed), the histogram and _Recent salary changes_                                                         | "Everything here is computed in SQL on the server. Currencies are never added together. The USD view is labelled as converted at a dated snapshot, and small groups are flagged."                                   |
| 0:40–1:05 | **Employees.** Type `sha` in search. Choose **Countries → Japan**. Click the **Hire date** header to sort. Go to the **next page**, then press the browser's **Back**                                                                                                                                  | "Search, filters, sorting and paging all run on the server, 25 rows at a time. The browser never holds the 10,000 records. The view lives in the URL, so it can be shared, and Back works."                         |
| 1:05–1:45 | Open an employee. Show **Salary history** with the _Current_ marker. Click **Add salary change**, enter an effective date next month and reason _Promotion_, and save; it shows as _Scheduled_. Click **Correct** on a record, change the amount, type a reason and save. Open the **Audit trail** tab | "Salary is an effective-dated timeline, and a database constraint guarantees periods never overlap. Future changes are allowed. A correction needs a reason. Every change records who, when, and before and after." |
| 1:45–2:15 | **Analytics.** Switch _Group by_ to **Country**, then _Show amounts in_ to **Pay currency**. Point at a _Small sample_ badge and the 24-month **trend**. Click **Show data table** under a chart                                                                                                       | "Min, quartiles, median, max and average per group, exact on the server. The trend counts the people employed at each month end, including people who've since left. Every chart has a table, for accessibility."   |
| 2:15–2:45 | **Import & export.** Upload `demo-import.csv`. The preview shows **3 valid, 1 invalid, 1 duplicate**, each with its message. Click **Import 3 employees** and confirm. Back on **Employees**, filter by Japan and click **Export CSV**                                                                 | "Import is a two-step preview, then one transaction that can only happen once. Duplicates and bad rows are never imported. The export is manager-only, audited, and safe to open in Excel."                         |
| 2:45–3:00 | Optional: sign out and sign in as the **HR Viewer** to show that write buttons are gone. Then close                                                                                                                                                                                                    | "Roles are enforced by the API, not just hidden in the UI. It has 233 automated tests plus 19 browser tests with accessibility checks, and CI runs the reviewer setup on three operating systems. Thank you."       |

## If something goes wrong on stage

- **Live site slow or unreachable:** switch to the local run. Its data is identical (the same deterministic seed and checksum).
- **"A salary period already starts on …":** that date has been used before for this employee. Pick another date. It's the database's overlap protection working.
- **The CSV import shows all rows as duplicates:** it was already imported once. Show the preview (it still demonstrates validation), or edit the IDs and emails and upload again.
- **"Too many sign-in attempts. Please wait a few minutes and try again.":** failed sign-ins are rate-limited for 15 minutes. Use the other account, or a local run.

## Facts to have ready for questions

- **Money:** stored as PostgreSQL `NUMERIC(19,4)` and sent as decimal strings, never floats. Decimals are checked against each currency's minor units (JPY 0, USD 2). See [ADR-0002](./adr/0002-money-and-multi-currency-analytics.md).
- **Performance, locally with 10,000 employees:**
  - **Employee list:** p95 4.4 ms.
  - **Dashboard queries:** 31 ms or less each.
  - **Under load:** with 50 concurrent clients the list stays at p95 65 ms.
  - **Live from India:** about 0.3 s per request, mostly the network to US East.

  See [performance.md](./performance.md).

- **Security:**
  - Argon2id password hashing.
  - An HttpOnly, Secure, `__Host-` session cookie.
  - Origin checks.
  - Per-account and per-IP login limits.
  - A CSP.
  - An append-only audit log enforced by a database trigger.

  Known limits are in [production-readiness-review.md](./production-readiness-review.md).

- **How AI was used, and how its output was checked:** [ai-development-log.md](./ai-development-log.md).
