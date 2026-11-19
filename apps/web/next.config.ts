import type { NextConfig } from 'next';

// Same-origin API (ADR-0001): the browser only talks to this app; /api/* is forwarded to Express,
// so the HttpOnly session cookie is first-party. Rewrites are resolved at build time.
const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';
const isDev = process.env.NODE_ENV !== 'production';

// 'unsafe-inline' scripts are needed for Next.js hydration without per-request nonces; there is no
// third-party script on the page. 'unsafe-eval' is only added in development for React refresh.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig: NextConfig = {
  // A separate build directory lets the e2e stack run next to the dev server.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  transpilePackages: ['@acme/shared'],
  poweredByHeader: false,
  // Keep the development badge away from the sidebar footer.
  devIndicators: { position: 'bottom-right' },
  reactStrictMode: true,
  rewrites() {
    // Next accepts a sync or async function; nothing here needs awaiting.
    return Promise.resolve([{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }]);
  },
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]);
  },
};

export default nextConfig;
