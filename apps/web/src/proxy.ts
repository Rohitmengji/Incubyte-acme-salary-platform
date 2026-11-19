import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIES = ['acme_session', '__Host-acme_session'];
const FORWARDING_HEADERS = ['x-forwarded-for', 'x-real-ip', 'forwarded'];

/**
 * Next.js 16 proxy (formerly middleware). Two jobs, neither of which authorises anything - the API
 * checks the session and role on every request (ADR-0001):
 *
 * 1. /api/*: drop client-supplied forwarding headers. Next forwards external rewrites without
 *    rewriting X-Forwarded-For, so a browser could otherwise choose the "client IP" the API uses for
 *    rate limiting. Behind a trusted edge that sets the header itself (Vercel, a load balancer),
 *    set TRUST_FORWARDED_FOR=1 to keep it.
 * 2. Pages: send visitors without a session cookie to sign in.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    if (process.env.TRUST_FORWARDED_FOR === '1') return NextResponse.next();
    const headers = new Headers(request.headers);
    for (const name of FORWARDING_HEADERS) headers.delete(name);
    return NextResponse.next({ request: { headers } });
  }

  if (pathname === '/login') return NextResponse.next();
  if (SESSION_COOKIES.some((name) => request.cookies.has(name))) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/api/:path*', '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
