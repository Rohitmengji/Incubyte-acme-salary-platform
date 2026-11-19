'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { loginRequestSchema } from '@acme/shared';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { errorMessage } from '@/lib/api';
import { useLogin } from '@/lib/queries';

/** Only same-site relative paths are allowed after sign-in (prevents open redirects). */
export function safeNextPath(next: string | null): string {
  if (
    !next ||
    !next.startsWith('/') ||
    next.startsWith('//') ||
    next.startsWith('/\\') ||
    next.startsWith('/login')
  ) {
    return '/dashboard';
  }
  return next;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const login = useLogin();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit((values) =>
    login.mutate(values, { onSuccess: () => router.replace(safeNextPath(params.get('next'))) }),
  );

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
      {params.get('reason') === 'expired' && !login.error ? (
        <p
          role="status"
          className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200"
        >
          Your session has ended. Please sign in again.
        </p>
      ) : null}
      {login.error ? (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
        >
          {errorMessage(login.error)}
        </p>
      ) : null}
      <Field label="Work email" error={errors.email?.message} required>
        {(a11y) => (
          <Input {...a11y} type="email" autoComplete="username" autoFocus {...register('email')} />
        )}
      </Field>
      <Field label="Password" error={errors.password?.message} required>
        {(a11y) => (
          <Input
            {...a11y}
            type="password"
            autoComplete="current-password"
            {...register('password')}
          />
        )}
      </Field>
      <Button type="submit" className="w-full" pending={login.isPending}>
        {login.isPending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
