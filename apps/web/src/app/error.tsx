'use client';

import { Button } from '@/components/ui/button';

/** Last-resort boundary for unexpected rendering errors; data errors are handled per section. */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      role="alert"
      className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <h1 className="text-2xl font-semibold text-slate-900">Something went wrong</h1>
      <p className="max-w-md text-slate-600">
        An unexpected error occurred. Your data has not been changed.
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
