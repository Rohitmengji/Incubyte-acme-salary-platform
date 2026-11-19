# ADR-0001: Keep the API same-origin behind Next.js and use server-side sessions in HttpOnly cookies

**Status:** Accepted · 2026-11-19

## Context

The brief asks for a Next.js frontend and a separate Express API. The API serves salary data, which is sensitive. Auth tokens must not be kept in `localStorage`.

If the browser called the API on a different origin, the session cookie would be third-party. Safari's Intelligent Tracking Prevention and Chrome's cookie restrictions block those cookies, so login would break unpredictably in a deployed environment. It would also force `SameSite=None` cookies and CORS with credentials, which widens the CSRF surface.

Users are a few dozen internal HR staff. Sessions must be revocable on logout.

## Decision

- **Single origin.** The browser only calls the web origin. Next.js forwards `/api/*` to the Express API, and the cookie travels as a first-party cookie.
- **Opaque sessions.**
  - At login the API creates 256 random bits and stores only their SHA-256 hash in the `session` table.
  - The cookie is `HttpOnly; Secure` (in production), `SameSite=Lax` and `Path=/`, and in production uses the `__Host-` prefix.
  - Sessions have an absolute lifetime of 8 hours. Logout deletes the session row. Login always issues a new token.
- **The API is the only trust boundary.** Every route except login and health requires a session. Role checks (`HR_MANAGER`, `HR_VIEWER`) are declared per route. The Next.js `proxy.ts` only redirects users who aren't logged in, for a smooth experience. It doesn't secure anything.
- **CSRF.** `SameSite=Lax`, plus a check that unsafe methods carry an `Origin` header matching the configured web origin. Bodies must be JSON, except the CSV upload route.
- **CORS** allows only the configured web origin. The normal request path doesn't need CORS at all.

## Alternatives considered

- **JWT in `localStorage`.** Any XSS could steal it, and the brief forbids it.
- **Stateless JWT in a cookie.** It can't be revoked without a denylist, which is a session table by another name. At this scale it has no advantage over sessions.
- **Calling the API directly across origins with CORS credentials.** Third-party cookie blocking would break login, and it needs `SameSite=None` and more CSRF handling.
- **Auth.js / NextAuth.** It adds a framework for a single credentials login, and the session would live in Next.js instead of the API that enforces access.
- **Next.js route handlers as the only backend.** The brief asks for Express. Keeping domain logic in a separate service also keeps the boundaries clearer.

## Consequences

- **Gains:**
  - Sessions can be revoked.
  - CSRF protection stays simple.
  - The normal path needs no CORS.
  - Tokens can't be read by JavaScript.
- **Costs:**
  - Every authenticated request does one indexed session lookup.
  - The Next.js server adds a network hop.
  - The API must trust `X-Forwarded-For` from exactly one proxy hop so rate limiting sees the real client IP.
  - Next.js `rewrites` fix the API origin at build time. If a deployment needs it at runtime, switch to a route-handler proxy.
- **Not solved:** multi-factor authentication, SSO and password reset. All are out of scope.
- **Revisit if:** SSO is required, or third parties need to call the API (then switch to OAuth 2.0 / OIDC tokens).
