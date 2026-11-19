import { useSyncExternalStore } from 'react';
import { vi } from 'vitest';

/** In-memory stand-in for next/navigation so URL-state behaviour can be asserted in jsdom. */
let url = new URL('http://localhost/');
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const router = {
  push: vi.fn((href: string) => setUrl(href)),
  replace: vi.fn((href: string) => setUrl(href)),
  back: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

export function setUrl(href: string): void {
  url = new URL(href, 'http://localhost');
  notify();
}

export function currentUrl(): URL {
  return new URL(url);
}

export function resetNavigation(): void {
  url = new URL('http://localhost/');
  Object.values(router).forEach((fn) => fn.mockClear());
}

export const navigation = {
  useRouter: () => router,
  usePathname: () => useSyncExternalStore(subscribe, () => url.pathname),
  useSearchParams: () => {
    const search = useSyncExternalStore(subscribe, () => url.search);
    return new URLSearchParams(search);
  },
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
};
