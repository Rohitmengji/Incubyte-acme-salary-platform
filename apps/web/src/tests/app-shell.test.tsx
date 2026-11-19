import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from 'sonner';
import { describe, expect, it } from 'vitest';
import { AppShell } from '@/features/shell/app-shell';
import { router, setUrl } from './navigation-mock';
import { MANAGER, mockApi, problem, renderWithProviders } from './utils';

describe('AppShell', () => {
  it('stays signed in and says so when sign-out fails on the server', async () => {
    mockApi({
      'GET /auth/me': { body: { user: MANAGER } },
      'POST /auth/logout': problem(503, 'Service unavailable'),
    });
    renderWithProviders(
      <>
        <AppShell>page</AppShell>
        <Toaster />
      </>,
    );
    await userEvent.click(await screen.findByRole('button', { name: /Account menu/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByText(/Sign-out failed/)).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalledWith('/login');
  });

  it('goes to sign-in after a successful sign-out', async () => {
    mockApi({
      'GET /auth/me': { body: { user: MANAGER } },
      'POST /auth/logout': { status: 204 },
    });
    renderWithProviders(<AppShell>page</AppShell>);
    await userEvent.click(await screen.findByRole('button', { name: /Account menu/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
  });

  it('sends an expired session to sign-in, keeping the full page address and the reason', async () => {
    mockApi({ 'GET /auth/me': problem(401, 'Your session has expired.') });
    setUrl('/employees?country=JP&page=2');
    window.history.replaceState(null, '', '/employees?country=JP&page=2');
    renderWithProviders(<AppShell>page</AppShell>);
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        `/login?reason=expired&next=${encodeURIComponent('/employees?country=JP&page=2')}`,
      ),
    );
  });
});
