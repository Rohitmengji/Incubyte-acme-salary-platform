# Deployment (Vercel + Neon)

This is how the live demo was deployed on 2026-11-19, and how to repeat it. Every step below was run, and its result was checked as described. The design reasons are in [ADR-0006](./adr/0006-deploy-on-vercel-with-neon.md).

## What is running

| Part     | Where                                                                                          | Notes                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Web app  | Vercel project `incubyte-acme-salary` → **https://incubyte-acme-salary.vercel.app**            | Next.js 16. Root directory `apps/web`. `/api/*` is rewritten to the API project.                                               |
| API      | Vercel project `incubyte-acme-salary-api` → `https://incubyte-acme-salary-api.vercel.app`      | Express 5 as one Vercel Function (zero-config Express). Entry `apps/api/index.mts`. Function region `iad1` (Washington, D.C.). |
| Database | Neon Postgres 18.7 (Free plan) from the Vercel Marketplace, resource `incubyte-acme-salary-db` | Region `iad1` / AWS `us-east-1`, the same region as the function. Connected to the API project for production and preview.     |
| Data     | 10,000 synthetic employees and 17,830 salary periods                                           | Seeded from this repo's deterministic seed. The dataset checksum matches local (`195856c2…715b1`).                             |

**Vercel account:** the hobby team "rohitmengji403gmailcom's projects". Both apps were deployed with the Vercel CLI from this repository at commit `9c19907`. Later commits change only documentation, CI and the local-database script (`apps/api/scripts/db.mjs`), none of which is part of either deployed app. The projects aren't connected to the GitHub repository (see [Not done](#not-done)).

**Sign-in on the live demo** uses the published demo accounts from the README: `hr.manager@acme.example` / `Manager-Demo-2026!` and `hr.viewer@acme.example` / `Viewer-Demo-2026!`. That's acceptable only because every record is synthetic. It needed an explicit opt-in (`ALLOW_DEMO_PASSWORDS=1`) when seeding with `NODE_ENV=production`.

## Project settings

Both projects are set to:

- **Install command:** `cd ../.. && npm ci --no-audit --no-fund`. The install has to run at the repository root so npm links the `@acme/shared` workspace. Installing inside `apps/api` alone gave 290 instead of 863 packages, and the build failed with `Cannot find module '@acme/shared'`.
- **Include source files outside the root directory:** on (the default).
- **Deployment protection:** `prod_deployment_urls_and_all_previews`. Previews and per-deployment URLs need a Vercel login, but the production domains are public. The default for new projects (`all_except_custom_domains`) would also have hidden `*.vercel.app` production domains from reviewers.
- **Node.js:** 26.x.

On top of that:

| Project | Framework | Root directory | Build command             | Environment variables (production)                                                                                                                  |
| ------- | --------- | -------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| API     | Express   | `apps/api`     | `npm run prisma:generate` | `DATABASE_URL` (pooled, set by the Neon integration), `NODE_ENV=production`, `LOG_LEVEL=info`, `WEB_ORIGIN=https://incubyte-acme-salary.vercel.app` |
| Web     | Next.js   | `apps/web`     | default (`next build`)    | `API_ORIGIN=https://incubyte-acme-salary-api.vercel.app`. It's read at **build** time, because Next.js resolves rewrites when it builds.            |

The Neon integration also adds `DATABASE_URL_UNPOOLED`, `PG*` and `POSTGRES_*` variables to the API project. Only `DATABASE_URL` is read by the app.

`TRUST_FORWARDED_FOR` is **not** set on the web project. The proxy therefore strips client-supplied `X-Forwarded-For`, and the API sees the address of Vercel's own proxy. Login limits still work, because they're keyed per account and per IP+email. See [Known limits](#known-limits).

## Steps to reproduce

Prerequisites:

- a Vercel account;
- the Vercel CLI (`npx vercel@latest`, version 66.2 was used);
- a clean checkout of this repository;
- Node 24 or newer.

```bash
# 1. Projects (names are examples)
vercel project add incubyte-acme-salary-api
vercel project add incubyte-acme-salary
#    Then set framework, root directory, install command and deployment protection as in the table
#    above (dashboard, or `vercel api -X PATCH /v9/projects/<name> --input settings.json`).

# 2. Link the repository root to the API project and provision Neon. The Vercel account owner must
#    first accept Neon's marketplace terms in the browser; the CLI prints the link.
vercel link --yes --project incubyte-acme-salary-api
vercel integration add neon --billing-plan free_v3 --meta region=iad1 --meta auth=false \
  --name incubyte-acme-salary-db --environment production --environment preview --no-env-pull

# 3. Migrate and seed from your machine over the direct (unpooled) connection. Keep the pulled file
#    outside the repository and delete it afterwards: it contains database credentials.
vercel env pull /tmp/api.production.env --environment=production --yes
cd apps/api
DATABASE_URL="<DATABASE_URL_UNPOOLED from that file>" npx prisma migrate deploy
DATABASE_URL="<DATABASE_URL_UNPOOLED>" NODE_ENV=production ALLOW_DEMO_PASSWORDS=1 \
  SEED_MANAGER_PASSWORD='Manager-Demo-2026!' SEED_VIEWER_PASSWORD='Viewer-Demo-2026!' \
  npx tsx prisma/seed/run.ts
cd ../..

# 4. Environment variables, then production deployments. The API comes first, because the web build
#    needs its URL.
vercel env add NODE_ENV production      # production
vercel env add LOG_LEVEL production     # info
vercel deploy --prod                    # API (linked project)
VERCEL_PROJECT_ID=<web project id> VERCEL_ORG_ID=<team id> vercel env add API_ORIGIN production
VERCEL_PROJECT_ID=<web project id> VERCEL_ORG_ID=<team id> vercel deploy --prod
vercel env add WEB_ORIGIN production    # https://<web production domain>
vercel deploy --prod                    # API again, so it picks up WEB_ORIGIN
```

**For a non-demo environment**, don't set `ALLOW_DEMO_PASSWORDS`. Use unique `SEED_*_PASSWORD` values of 12 or more characters instead. The seed refuses demo passwords in production unless that opt-in is set.

## Verification that was run against the live site

**API and HTTP checks with `curl`:**

- `/login` returns 200. `/dashboard` and `/employees` redirect (307) to `/login?next=…`.
- The CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy` headers are present.
- `GET /api/v1/health` returns `{"status":"ok","database":"up"}` with `Cache-Control: no-store`, both through the web app and on the API domain.
- An unauthenticated `GET /api/v1/employees` returns 401.
- Signing in as the manager sets `__Host-acme_session` with `HttpOnly; Secure; SameSite=Lax`.
- The employee list reports 10,000 employees across 400 pages. The summary reports 10,000 records and 9,206 employed. The CSV export returns 200 with 1,347,968 bytes of `text/csv`.
- The viewer gets 403 on the export and on creating an employee.
- A sign-in with `Origin: https://evil.example` gets 403.
- After logout (204), the old cookie gets 401 on `/auth/me`.
- 12 failed sign-ins for one email, each with a different forged `X-Forwarded-For`, gave 401 eleven times and then 429. Locally the limit triggers after 10. The one extra attempt is consistent with the in-memory limiter running per function instance.

**Browser checks, read-only, Playwright Chromium, signed in as the viewer.** All 19 passed:

- **Sign-in:** a deep link redirects to sign-in and back again, and the session cookie has the right flags.
- **Filters and history:** the Japan filter works; "Clear filters" followed by a new filter doesn't bring back the cleared search; Back after paging returns to page 1 with the same filter and sort.
- **Pages:** search by employee ID; the employee detail page with salary history and no write actions for the viewer; the audit tab; analytics; the dashboard showing 10,000.
- **Accessibility:** axe finds no serious or critical violations on `/login`, `/dashboard`, `/employees`, the employee detail page and `/analytics`.
- **Phone viewport:** no horizontal page scroll.
- **Console:** no browser console errors.

**Deliberately not run against the live site:** the write journeys from the e2e suite (creating employees, salary changes, imports). They pass in CI against an isolated database, and running them on the demo would change its data.

## Problems found while deploying, and fixes

| Symptom                                                                                                    | Cause                                                                                                                   | Fix                                                                                       |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| The build failed with `Cannot find module '@acme/shared'` and knock-on type errors (`helmet` not callable) | The install ran inside `apps/api` only, so the npm workspace link was missing                                           | Install from the repository root (`cd ../.. && npm ci`)                                   |
| Every request failed with `FUNCTION_INVOCATION_FAILED`: "Cannot use import statement outside a module"     | Vercel bundled the ES-module entry into `server.js` with no `"type": "module"` beside it, so Node loaded it as CommonJS | Renamed the entry to `index.mts`, which is one of Vercel's documented Express entry names |
| `vercel link` appended `.env*` to `.gitignore`                                                             | The CLI's default behaviour. The appended line would also have ignored the committed `.env.example`.                    | Removed the appended lines. `.vercel/` is ignored explicitly instead.                     |
| `VERCEL_EXPERIMENTAL_BACKENDS=1` was tried                                                                 | It didn't help with either problem above                                                                                | Removed. The standard Express build is used.                                              |

## Resetting the demo data

The seed only ever inserts what's missing, so it **doesn't** undo reviewers' edits. To restore the demo exactly, rebuild the database over the unpooled connection, then seed again as in step 3. This drops all data in that database:

```bash
DATABASE_URL="<DATABASE_URL_UNPOOLED>" npx prisma migrate reset --force --skip-seed
```

This hasn't been needed or run on the live database.

## Known limits

- **Latency:** the function and the database are in US East, so users far away pay the round trip. From India, the API's health check took about 300 ms end to end (see [performance](./performance.md#live-deployment-vercel--neon)). Moving both the function and Neon to `sin1` would bring them closer to India.
- **Rate limits** live in memory, per function instance. A production deployment would need a shared store, such as Postgres or Redis.
- **The client IP isn't visible to the API.** It sees Vercel's proxy, so the per-IP part of the limits applies to all anonymous traffic together. Signed-in traffic is limited per session.
- **The API's own domain is public.** It applies the same authentication, role checks and origin checks as when it's reached through the web app.

## Not done

- The Vercel projects aren't connected to the GitHub repository, so pushes don't deploy automatically. Connecting them needs the Vercel GitHub app installed for the `Rohitmengji` account, which the Vercel account owner has to do in a browser.
- No custom domain.
- Vercel recommends enabling two-factor authentication on this Vercel account. That's an account setting for the owner.
