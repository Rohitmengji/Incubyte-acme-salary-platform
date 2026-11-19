import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LoginForm } from '@/features/auth/login-form';
import { router, setUrl } from './navigation-mock';
import { MANAGER, mockApi, problem, renderWithProviders } from './utils';

describe('LoginForm', () => {
  it('validates required fields on the client without calling the API', async () => {
    const { fetchMock } = mockApi({});
    renderWithProviders(<LoginForm />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findAllByText('Required')).toHaveLength(2);
    expect(screen.getByLabelText(/Work email/)).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the server message on failed sign-in', async () => {
    mockApi({ 'POST /auth/login': problem(401, 'Invalid email or password.') });
    renderWithProviders(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/Work email/), 'hr.manager@acme.example');
    await userEvent.type(screen.getByLabelText(/Password/), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('signs in and returns to a safe "next" path, ignoring external ones', async () => {
    const { calls } = mockApi({ 'POST /auth/login': { body: { user: MANAGER } } });
    setUrl('/login?next=//evil.example');
    renderWithProviders(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/Work email/), ' HR.Manager@acme.example ');
    await userEvent.type(screen.getByLabelText(/Password/), 'Manager-Demo-2026!');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/dashboard'));
    expect(calls[0]?.body).toEqual({
      email: 'hr.manager@acme.example',
      password: 'Manager-Demo-2026!',
    });
  });

  it('tells the user when their session expired', () => {
    mockApi({});
    setUrl('/login?reason=expired');
    renderWithProviders(<LoginForm />);
    expect(screen.getByRole('status')).toHaveTextContent('Your session has ended');
  });
});
