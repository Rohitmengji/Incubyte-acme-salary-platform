import { expect, type Page } from '@playwright/test';

export const USERS = {
  manager: { email: 'hr.manager@acme.example', password: 'Manager-Demo-2026!' },
  viewer: { email: 'hr.viewer@acme.example', password: 'Viewer-Demo-2026!' },
};

export async function login(page: Page, role: keyof typeof USERS, next?: string): Promise<void> {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  await page.getByLabel('Work email').fill(USERS[role].email);
  await page.getByLabel('Password').fill(USERS[role].password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(next ? new RegExp(next.replace(/[?]/g, '\\?')) : /\/dashboard$/);
}

/** Unique per run so specs never collide with seeded data or each other. */
export function uniqueCode(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}
