# ACME Salary Management Platform: Requirements

**Status:** Draft for review · **Owner:** Rohit Mengji · **Updated:** 2026-11-19

## Problem

ACME has 10,000 employees in several countries. HR keeps their salaries in Excel. That makes edits tedious, loses salary history, and leaves no audit trail. It's also hard to answer _"how do we pay our people?"_ across countries, departments and roles.

## Users

- **HR Manager** (primary): maintains employee and salary records and answers compensation questions from leadership. Comfortable with spreadsheets, but not technical.
- **HR Viewer** (secondary): has read-only access. This role exists to show that role-based access control works.

## Goals

1. Replace the spreadsheet for day-to-day salary maintenance with a system that validates and audits every change.
2. Answer distribution questions by country, department and job title within seconds, without misleading cross-currency maths.
3. Stay fast with 10,000 employees on desktop, tablet and mobile.

## Functional requirements

| Area          | Must have                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Auth**      | Email and password login for seeded HR users, plus logout and session expiry. There are two roles. `HR_MANAGER` can read, write, import and export. `HR_VIEWER` can only read.                                                                                                                                                                                                                                                                   |
| **Employees** | The list is paginated on the server (25, 50 or 100 per page). HR can search it by name or employee ID, filter it by country, department, job title and status, and sort it. They can also open a profile, create and edit employees, deactivate them, and undo a mistaken deactivation. Records are never hard-deleted.                                                                                                                          |
| **Salary**    | Show the current salary and full history. HR can add a salary change with an effective date (future dates allowed), currency and reason, and can correct a record. Periods never overlap. Every change is audited with who, when, and the before and after values.                                                                                                                                                                               |
| **Dashboard** | Total employee records with a breakdown by status, plus employed headcount by country. Average and median salary **per currency**, plus a clearly labelled USD-normalised view at a dated FX snapshot. Salary distribution by department, a compensation histogram, and recent salary changes, including corrections.                                                                                                                            |
| **Analytics** | Headcount, min, max, average and median salary by country, department and job title, plus a salary trend over time built from history. The trend counts the people employed at each date. The server computes everything in SQL. Groups with fewer than 5 people are flagged as a small sample.                                                                                                                                                  |
| **CSV**       | Import works in two steps: upload, then server validation and a preview. The preview splits rows into valid, invalid and duplicate, with a message for each problem row. Committing imports all valid rows at once. Duplicates (an existing employee ID or email) are never imported. HR can export the filtered employee list with current salaries. Export is `HR_MANAGER` only, audited, and protected against spreadsheet formula injection. |

## Non-functional requirements

- **Correctness:** money is stored as PostgreSQL `NUMERIC` and sent as decimal strings, never as JavaScript floats. Amounts are checked against the currency's minor units (JPY 0, USD 2).
- **Security:** passwords hashed with Argon2id. An opaque session token in an `HttpOnly`, `Secure`, `SameSite` cookie, never in `localStorage`. Every input validated and every route role-checked on the server. Login rate-limited, strict CORS and origin checks, safe error messages, `Cache-Control: no-store` on salary data. Synthetic seed data only, no secrets in Git. Details are in [architecture §10](./architecture.md#10-security-model).
- **Performance** (targets to measure, not claims): employee list API p95 under 200 ms and dashboard API under 500 ms with 10,000 employees locally. The browser never receives the full dataset. Seeding 10,000 employees takes under 60 s and is safe to run repeatedly.
- **Accessibility:** WCAG 2.2 AA: semantic HTML, full keyboard operation, visible focus, labelled fields, accessible dialogs, live-region feedback, a contrast-checked palette, and a table view for every chart.
- **Operability:** local setup without Docker, plus Docker Compose. Structured logs with request IDs, a health endpoint, and CI on every push.
- **Quality:** TypeScript strict mode. Salary timeline, money and CSV rules built test-first. Integration tests against real PostgreSQL. Playwright covers the five critical journeys.

## Out of scope (deliberately)

Payroll runs, tax and deductions, and bank payments. Bonus, equity and allowances. SSO and multi-factor authentication. Live FX feeds, multi-tenancy, approval workflows and employee self-service. Rehire and employment intervals, and history of department or title changes. A UI for managing users (users are seeded). Each would take weeks and wouldn't help answer the core question: _what do we pay, to whom, and how has it changed?_

## Assumptions

- Salary means **annual gross base salary** in the employee's pay currency. The pay currency can differ from the country's default (for example, an expat).
- All employees are salaried and full-time, so there's no part-time pro-rating.
- Effective dates are calendar dates, and "today" is worked out in UTC.
- HR supplies the employee ID (for example `EMP-000123`), which matches their existing spreadsheets. It's unique and never changes.
- FX rates are a seeded, dated snapshot of illustrative values. They're for reporting only and never used for payroll.
- There's one organisation, with a few dozen HR users at most.

## Reviewer experience (acceptance target)

An interviewer clones the repo and runs `npm install`, `npm run setup` and `npm run dev`. They log in with the demo credentials from the README and can run every test suite. They don't need to install Docker or PostgreSQL. A Vercel deployment is a secondary target.
