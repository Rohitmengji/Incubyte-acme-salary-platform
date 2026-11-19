import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm font-semibold text-brand-700">404</p>
      <h1 className="text-2xl font-semibold text-slate-900">Page not found</h1>
      <p className="text-slate-600">The page you are looking for does not exist or has moved.</p>
      <Link href="/dashboard" className={buttonVariants({ className: 'mt-2' })}>
        Go to the dashboard
      </Link>
    </main>
  );
}
