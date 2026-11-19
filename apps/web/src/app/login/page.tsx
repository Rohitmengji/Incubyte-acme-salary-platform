import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/features/auth/login-form';
import { Logo } from '@/features/shell/logo';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-brand-50 to-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
          <p className="mt-1 mb-6 text-sm text-slate-600">
            Salary management for the ACME HR team.
          </p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        {process.env.NODE_ENV === 'development' ? (
          <p className="mt-4 text-center text-xs text-slate-600">
            Local demo accounts are listed in the README (HR Manager and read-only HR Viewer).
          </p>
        ) : null}
      </div>
    </main>
  );
}
