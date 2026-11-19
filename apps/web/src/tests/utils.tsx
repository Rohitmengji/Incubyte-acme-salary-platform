import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import type { AuthUser } from '@acme/shared';
import { CurrentUserContext } from '@/features/shell/app-shell';

export const MANAGER: AuthUser = {
  id: 'u1',
  email: 'hr.manager@acme.example',
  displayName: 'Hannah Reyes',
  role: 'HR_MANAGER',
};
export const VIEWER: AuthUser = {
  id: 'u2',
  email: 'hr.viewer@acme.example',
  displayName: 'Victor Lam',
  role: 'HR_VIEWER',
};

export function renderWithProviders(
  ui: ReactElement,
  { user = MANAGER }: { user?: AuthUser } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <CurrentUserContext.Provider value={user}>{ui}</CurrentUserContext.Provider>
      </QueryClientProvider>,
    ),
  };
}

type Handler = (request: {
  url: URL;
  method: string;
  body: unknown;
}) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>;

/**
 * Stubs fetch at the network boundary: components, hooks, TanStack Query and validation all run for
 * real. Routes are "METHOD /path" keys (path without /api/v1 and query string).
 */
export function mockApi(routes: Record<string, Handler | { status?: number; body?: unknown }>) {
  const calls: { method: string; url: URL; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    const url = new URL(href, 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const key = `${method} ${url.pathname.replace(/^\/api\/v1/, '')}`;
    const route = routes[key];
    if (!route)
      return new Response(
        JSON.stringify({ type: 'x', title: 'Not mocked', status: 404, detail: key }),
        { status: 404, headers: { 'content-type': 'application/problem+json' } },
      );
    const result = typeof route === 'function' ? await route({ url, method, body }) : route;
    const status = result.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(result.body ?? {}), {
      status,
      headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export function problem(
  status: number,
  detail: string,
  extra: { slug?: string; errors?: { path: string; message: string }[] } = {},
) {
  return {
    status,
    body: {
      type: `https://acme-salary.example/problems/${extra.slug ?? 'x'}`,
      title: 'Error',
      status,
      detail,
      requestId: 'r1',
      ...extra,
    },
  };
}
