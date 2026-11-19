'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { ApiError, setUnauthorizedHandler } from '@/lib/api';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Retry transient server/network failures only; never 4xx (they will not fix themselves).
        retry: (count, error) => count < 2 && !(error instanceof ApiError && error.status < 500),
      },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const router = useRouter();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      queryClient.clear();
      const next = `${window.location.pathname}${window.location.search}`;
      router.replace(`/login?reason=expired&next=${encodeURIComponent(next)}`);
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient, router]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster position="top-right" closeButton toastOptions={{ duration: 5000 }} />
    </QueryClientProvider>
  );
}
