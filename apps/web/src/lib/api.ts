import type { ProblemDetails } from '@acme/shared';

/** Error carrying the API's RFC 9457 problem details. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetails,
  ) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }

  get fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.problem.errors ?? []).map((e) => [e.path, e.message]));
  }

  get isStaleVersion(): boolean {
    return this.status === 409 && this.problem.type.endsWith('/stale-version');
  }
}

export type QueryValue = string | number | boolean | null | undefined | (string | number)[];

export function toQueryString(query: Record<string, QueryValue> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, String(v)));
    else params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

let onUnauthorized: (() => void) | null = null;

/** Lets the app decide what to do when a session expires mid-use (redirect to sign-in). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/**
 * Same-origin fetch to the API (proxied by Next.js). The session cookie is HttpOnly, so JavaScript
 * never sees it; the browser attaches it automatically.
 */
export async function api<T>(
  path: string,
  { method = 'GET', body, query, signal }: RequestOptions = {},
): Promise<T> {
  const response = await fetch(`/api/v1${path}${toQueryString(query)}`, {
    method,
    signal,
    credentials: 'same-origin',
    headers:
      body === undefined
        ? { Accept: 'application/json' }
        : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return undefined as T;
  const isJson = (response.headers.get('content-type') ?? '').includes('json');
  const payload: unknown = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const problem: ProblemDetails =
      payload && typeof payload === 'object' && 'title' in payload
        ? (payload as ProblemDetails)
        : {
            type: 'about:blank',
            title: response.statusText || 'Request failed',
            status: response.status,
            detail: 'Something went wrong. Please try again.',
          };
    if (response.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
    throw new ApiError(response.status, problem);
  }
  return payload as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError)
    return 'Could not reach the server. Check your connection and try again.';
  return 'Something went wrong. Please try again.';
}
