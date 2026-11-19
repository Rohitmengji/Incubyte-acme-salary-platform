'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { employeeListQuerySchema, type EmployeeListQuery } from '@acme/shared';

const LIST_KEYS = ['country', 'department', 'jobTitle', 'status'] as const;
const DEFAULTS = employeeListQuerySchema.parse({});

export type EmployeeQueryChanges = Partial<Omit<EmployeeListQuery, 'page'>> & { page?: number };

/** Parses the list's URL state; anything invalid falls back to defaults rather than erroring. */
export function parseEmployeeQuery(params: URLSearchParams): EmployeeListQuery {
  const raw: Record<string, unknown> = {};
  for (const key of ['search', 'sort', 'order', 'page', 'pageSize']) {
    const value = params.get(key);
    if (value !== null) raw[key] = value;
  }
  for (const key of LIST_KEYS) {
    const values = params.getAll(key);
    if (values.length) raw[key] = values;
  }
  const parsed = employeeListQuerySchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULTS;
}

export function serializeEmployeeQuery(query: EmployeeListQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  for (const key of LIST_KEYS)
    for (const value of query[key] ?? []) params.append(key, String(value));
  if (query.sort !== DEFAULTS.sort) params.set('sort', query.sort);
  if (query.order !== DEFAULTS.order) params.set('order', query.order);
  if (query.page !== 1) params.set('page', String(query.page));
  if (query.pageSize !== DEFAULTS.pageSize) params.set('pageSize', String(query.pageSize));
  return params.toString();
}

/**
 * The employee list's filters, sort and page live in the URL: views can be shared and bookmarked,
 * and back/forward work. Any change other than paging returns to page 1.
 */
export function useEmployeeQueryState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const query = useMemo(() => parseEmployeeQuery(new URLSearchParams(params.toString())), [params]);

  /**
   * Filter, sort and page changes push a history entry so Back/Forward step through list states.
   * Search-as-you-type replaces the entry so each debounced keystroke does not add one.
   */
  const update = useCallback(
    (
      changes: EmployeeQueryChanges,
      { history = 'push' }: { history?: 'push' | 'replace' } = {},
    ) => {
      const next: EmployeeListQuery = { ...query, ...changes, page: changes.page ?? 1 };
      const qs = serializeEmployeeQuery(next);
      router[history](qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [query, router, pathname],
  );

  const reset = useCallback(() => router.push(pathname, { scroll: false }), [router, pathname]);

  const hasFilters = Boolean(
    query.search || query.country || query.department || query.jobTitle || query.status,
  );
  return { query, update, reset, hasFilters };
}
