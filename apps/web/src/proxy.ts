import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIES = ['acme_session', '__Host-acme_session'];

/**
 * Redirect-only guard (Next.js 16 proxy): sends visitors without a session cookie to sign in.
 * It does not authorise anything - the API checks the session and role on every request (ADR-0001).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === '/login') return NextResponse.next();
  if (SESSION_COOKIES.some((name) => request.cookies.has(name))) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
