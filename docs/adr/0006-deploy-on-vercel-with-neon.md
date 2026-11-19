# ADR-0006: Deploy the demo as two Vercel projects with Neon Postgres

**Status:** Accepted · 2026-11-19

## Context

The assessment asks for a hosted demo next to the local reviewer path. Constraints:

- **Same-origin cookies.** The browser must keep talking to one origin so the session cookie stays first-party ([ADR-0001](./0001-same-origin-api-and-cookie-sessions.md)).
- **PostgreSQL 18.** The schema uses PostgreSQL 18's `uuidv7()`, plus the `pg_trgm` and `btree_gist` extensions.
- **No credentials in the repository.** The repository stays private and free of secrets, and the deployment mustn't need any that live in Git.
- **Who can act on the account.** The Vercel account belongs to the candidate. Accepting a marketplace provider's terms is the account owner's decision, not something to automate.
- **No Docker.** A container platform would need Docker files, and the candidate decided not to deliver Docker.

## Decision

- **Two Vercel projects from the same repository.**
  - **Web:** the Next.js app, root directory `apps/web`.
  - **API:** the Express app as one Vercel Function, root directory `apps/api`, using Vercel's zero-config Express support. Its entry, `apps/api/index.mts`, builds the same app as `src/server.ts` but exports it instead of listening.
  - The web project's existing `/api/*` rewrite points at the API project's production domain through `API_ORIGIN`, which is read when the web app is built.
  - The browser still only sees the web origin, so ADR-0001 holds unchanged.
- **Neon Postgres from the Vercel Marketplace** (Free plan), in the same region as the function (`iad1` / `us-east-1`). It was checked to run PostgreSQL 18.7 with `uuidv7()`, `pg_trgm` and `btree_gist` available before migrating.
  - The app uses the pooled `DATABASE_URL`.
  - Migrations and the seed run from a developer machine over the unpooled URL, with `prisma migrate deploy` and the normal seed script.
- **Installs run at the workspace root** (`cd ../.. && npm ci`), so npm links `@acme/shared` exactly as it does locally.
- **Demo sign-in uses the published demo passwords**, which is acceptable only because the data is synthetic. That requires an explicit `ALLOW_DEMO_PASSWORDS=1` when seeding with `NODE_ENV=production`. Without it, the seed refuses them.
- **Deployment protection** stays on for previews and per-deployment URLs. The production domains are public so reviewers can open them.

## Alternatives considered

- **API as Next.js route handlers.** One project instead of two, but the Express app would have to be rewritten for the Fetch API, or wrapped in an adapter. It would also diverge from what runs and is tested locally.
- **A container host** (Render, Fly.io, Railway). The API would run as-is, but it would need Docker files and another account. Docker was ruled out.
- **Prisma Postgres or Supabase.** Both are viable. Neon is native to the Vercel Marketplace, so credentials go straight into the project's environment.
- **Connecting the projects to GitHub for automatic deployments.** That needs the Vercel GitHub app installed by the account owner. Deploying from the CLI was enough for a verified demo.

## Consequences

- **Gains:**
  - No extra infrastructure code.
  - The deployed API is the same code that the tests exercise.
  - The database engine matches local and CI (PostgreSQL 18).
  - No secrets in the repository.
- **Costs:**
  - **Two proxies on every API call.** Requests pass through the web project's rewrite and then the API project's edge. From India, the round trip to US East is about 300 ms for even the simplest request. See [performance](../performance.md#live-deployment-vercel--neon).
  - **Rate limits live in memory, per function instance**, so they are approximate. A shared store would be needed for real production.
  - **The API can't see the client's IP**, only Vercel's proxy. Login limits still apply per account and per IP+email; signed-in traffic is limited per session.
  - **Seeding over the internet takes about 100 s**, compared with 3.7 s locally.
  - **The API's own domain is public.** It applies the same checks as when reached through the web app.
- **Revisit if:** the demo needs low latency outside the US (move the function and database to the users' region), real users (shared rate-limit store, a custom domain, strong passwords), or automatic deployments (connect Git).
