import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('mobile: navigation menu, employee list and detail work on a phone-sized screen', async ({
  page,
}) => {
  await login(page, 'manager');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page
    .getByRole('dialog', { name: 'Navigation' })
    .getByRole('link', { name: 'Employees' })
    .click();
  await expect(page.getByRole('heading', { name: 'Employees' })).toBeVisible();

  await page.getByLabel('Search by name or employee ID').fill('EMP-000007');
  await expect(page.getByText(/Showing 1–1 of 1$/)).toBeVisible();
  await page.locator('tbody a').first().click();
  await expect(page.getByRole('tab', { name: 'Salary history' })).toBeVisible();
  // The page itself must not scroll sideways; wide tables scroll inside their own container.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
