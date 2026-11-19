'use client';

import { DropdownMenu } from 'radix-ui';
import {
  BarChart3,
  ChevronDown,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Menu,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthUser } from '@acme/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState } from '@/components/ui/states';
import { Skeleton } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useLogout, useSession } from '@/lib/queries';
import { Logo } from './logo';

export const CurrentUserContext = createContext<AuthUser | null>(null);

export function useCurrentUser(): AuthUser & { canWrite: boolean } {
  const user = useContext(CurrentUserContext);
  if (!user) throw new Error('useCurrentUser must be used inside <AppShell>');
  return { ...user, canWrite: user.role === 'HR_MANAGER' };
}

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, managerOnly: false },
  { href: '/employees', label: 'Employees', icon: Users, managerOnly: false },
  { href: '/analytics', label: 'Analytics', icon: BarChart3, managerOnly: false },
  { href: '/imports', label: 'Import & export', icon: FileSpreadsheet, managerOnly: true },
];

function NavLinks({ user, onNavigate }: { user: AuthUser; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-1">
      {NAV.filter((item) => !item.managerOnly || user.role === 'HR_MANAGER').map(
        ({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
                  active
                    ? 'bg-brand-50 text-brand-800'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                <Icon aria-hidden="true" className="size-4" />
                {label}
              </Link>
            </li>
          );
        },
      )}
    </ul>
  );
}

function UserMenu({ user }: { user: AuthUser }) {
  const logout = useLogout();
  const router = useRouter();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" className="h-10 gap-2 px-2">
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800"
          >
            {user.displayName.slice(0, 1)}
          </span>
          <span className="hidden text-left sm:block">
            <span className="block text-sm leading-tight font-medium text-slate-900">
              {user.displayName.replace(/\s*\(.*\)$/, '')}
            </span>
            <span className="block text-xs leading-tight text-slate-600">
              {user.role === 'HR_MANAGER' ? 'HR Manager' : 'HR Viewer (read-only)'}
            </span>
          </span>
          <ChevronDown aria-hidden="true" />
          <span className="sr-only">Account menu</span>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-48 rounded-md border border-slate-200 bg-white p-1 shadow-lg"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-xs text-slate-600">
            {user.email}
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="my-1 h-px bg-slate-100" />
          <DropdownMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-800 outline-none data-highlighted:bg-slate-100"
            onSelect={() => logout.mutate(undefined, { onSettled: () => router.replace('/login') })}
          >
            <LogOut aria-hidden="true" className="size-4" /> Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const unauthenticated = session.error instanceof ApiError && session.error.status === 401;
  useEffect(() => {
    if (unauthenticated) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [unauthenticated, router, pathname]);

  if (session.isPending || unauthenticated) {
    return (
      <div role="status" className="p-8">
        <span className="sr-only">Loading your workspace…</span>
        <Skeleton className="mb-4 h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (session.error)
    return <ErrorState error={session.error} onRetry={() => void session.refetch()} />;
  const user = session.data;

  return (
    <CurrentUserContext.Provider value={user}>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-white px-4 py-2 text-sm font-medium shadow focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to main content
      </a>
      <div className="flex min-h-dvh">
        <nav
          aria-label="Main"
          className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-4 lg:flex"
        >
          <Link href="/dashboard" className="mb-6 px-2">
            <Logo />
          </Link>
          <NavLinks user={user} />
          <p className="mt-auto px-3 text-xs text-slate-500">Synthetic demo data</p>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
            <div className="flex items-center gap-2 lg:hidden">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open navigation"
                onClick={() => setMenuOpen(true)}
              >
                <Menu aria-hidden="true" />
              </Button>
              <Logo compact />
            </div>
            <div className="hidden lg:block" />
            <UserMenu user={user} />
          </header>
          <main
            id="main"
            tabIndex={-1}
            className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8"
          >
            {children}
          </main>
        </div>
      </div>

      <Dialog
        open={menuOpen}
        onOpenChange={setMenuOpen}
        title="Navigation"
        className="top-0 left-0 h-dvh max-h-dvh w-72 max-w-[85vw] translate-x-0 translate-y-0 rounded-none"
      >
        <nav aria-label="Main">
          <NavLinks user={user} onNavigate={() => setMenuOpen(false)} />
        </nav>
      </Dialog>
    </CurrentUserContext.Provider>
  );
}
