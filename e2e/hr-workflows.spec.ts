import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { login, uniqueCode } from './helpers';

test.describe('authentication', () => {
  test('redirects to sign-in, rejects a wrong password, then returns to the requested page', async ({
    page,
  }) => {
    await page.goto('/employees?country=JP');
    await expect(page).toHaveURL(/\/login\?next=%2Femployees%3Fcountry%3DJP/);

    await page.getByLabel('Work email').fill('hr.manager@acme.example');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    // Next.js adds its own role=alert route announcer, so match the message itself.
    await expect(
      page.getByRole('alert').filter({ hasText: 'Invalid email or password.' }),
    ).toBeVisible();

    await page.getByLabel('Password').fill('Manager-Demo-2026!');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/employees\?country=JP$/);
    await expect(page.getByLabel('Countries')).toHaveValue('JP');
  });

  test('signs out and protects pages again', async ({ page }) => {
    await login(page, 'manager');
    await page.getByRole('button', { name: /account menu/i }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  });

  test('never follows a "next" link to another site after sign-in', async ({ page }) => {
    // Browsers treat "/\t/evil.example" as the protocol-relative "//evil.example".
    await page.route(
      (url) => url.hostname === 'evil.example',
      (route) => route.abort(),
    );
    await page.goto('/login?next=%2F%09%2Fevil.example');
    await page.getByLabel('Work email').fill('hr.viewer@acme.example');
    await page.getByLabel('Password').fill('Viewer-Demo-2026!');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/dashboard$/);
  });
});

test('dashboard shows organisation-wide figures from the seeded 10,000 employees', async ({
  page,
}) => {
  await login(page, 'manager');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Employee records')).toBeVisible();
  await expect(page.getByText('10,000', { exact: true })).toBeVisible();
  await expect(page.getByText(/USD at the 31 Oct 2026 FX snapshot/)).toBeVisible();
  // Pay by currency never mixes currencies: one row per currency.
  const payTable = page
    .getByRole('table')
    .filter({ has: page.getByRole('rowheader', { name: 'JPY' }) });
  await expect(payTable.getByRole('rowheader')).toHaveCount(7);
  await expect(page.getByRole('img', { name: /Headcount by country/ })).toBeVisible();
});

test('employee search, filters, sorting and pagination run on the server and live in the URL', async ({
  page,
}) => {
  await login(page, 'viewer');
  await page.getByRole('link', { name: 'Employees' }).first().click();
  await expect(page.getByText(/Showing 1–25 of 10,000/)).toBeVisible();

  await page.getByLabel('Search by name or employee ID').fill('EMP-000042');
  await expect(page).toHaveURL(/search=EMP-000042/);
  await expect(page.getByText(/Showing 1–1 of 1$/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByText(/of 10,000/)).toBeVisible();

  await page.getByLabel('Countries').selectOption('JP');
  await expect(page).toHaveURL(/country=JP/);
  await expect(page.getByRole('row').nth(1)).toContainText('Japan');

  await page.getByRole('button', { name: 'Hire date' }).click();
  await expect(page.getByRole('columnheader', { name: 'Hire date' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText(/Showing 26–50 of/)).toBeVisible();
  // Each filter/sort/page change is a history entry, so Back steps through the list states.
  await page.goBack();
  await expect(page).toHaveURL(/\/employees\?.*country=JP/);
  await expect(page).not.toHaveURL(/page=2/);
  await expect(page.getByText(/Showing 1–25 of/)).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Hire date' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await page.goBack();
  await expect(page).toHaveURL(/\/employees\?country=JP$/);
});

test('HR manager creates an employee, changes and corrects their salary, and sees the audit trail', async ({
  page,
}) => {
  const code = uniqueCode('E2E');
  await login(page, 'manager');
  await page.goto('/employees/new');

  await page.getByLabel('Employee ID').fill(code);
  await page.getByLabel('Work email').fill(`${code.toLowerCase()}@acme.example`);
  await page.getByLabel('First name').fill('Meera');
  await page.getByLabel('Last name').fill('Krishnan');
  await page.getByLabel('Country').selectOption('IN');
  await expect(page.getByLabel('Currency')).toHaveValue('INR'); // suggested from the country
  await page.getByLabel('Hire date').fill('2024-04-01');
  await page.getByLabel('Department').selectOption({ label: 'Engineering' });
  await page.getByLabel('Job title').selectOption({ label: 'Software Engineer II' });
  await page.getByLabel('Annual salary').fill('1,800,000');
  await page.getByRole('button', { name: 'Add employee' }).click();
  await expect(page.getByText(/plain decimal number/)).toBeVisible(); // client-side validation
  await page.getByLabel('Annual salary').fill('1800000');
  await page.getByRole('button', { name: 'Add employee' }).click();

  await expect(page.getByRole('heading', { name: 'Meera Krishnan' })).toBeVisible();
  await expect(page.getByText('INR 1,800,000.00').first()).toBeVisible();

  // Salary change
  await page.getByRole('button', { name: 'Add salary change' }).click();
  const change = page.getByRole('dialog', { name: 'Add salary change' });
  await change.getByLabel('New annual salary').fill('2100000');
  await change.getByLabel('Effective from').fill('2025-04-01');
  await change.getByLabel('Reason').selectOption('PROMOTION');
  await change.getByRole('button', { name: 'Save salary change' }).click();
  await expect(change).toBeHidden();
  const history = page.getByRole('table', { name: /Salary history/ });
  await expect(history.getByRole('row')).toHaveCount(3);
  await expect(history.getByRole('row').nth(1)).toContainText('INR 2,100,000.00');
  await expect(history.getByRole('row').nth(1)).toContainText('Current');

  // Same date again is rejected by the server and shown on the field
  await page.getByRole('button', { name: 'Add salary change' }).click();
  await change.getByLabel('New annual salary').fill('2200000');
  await change.getByLabel('Effective from').fill('2025-04-01');
  await change.getByRole('button', { name: 'Save salary change' }).click();
  await expect(change.getByText(/already starts on 2025-04-01/).first()).toBeVisible();
  // The rejected field gets focus so its error is announced.
  await expect(change.getByLabel('Effective from')).toBeFocused();
  await change.getByRole('button', { name: 'Cancel' }).click();
  // Closing a dialog returns focus to the button that opened it.
  await expect(page.getByRole('button', { name: 'Add salary change' })).toBeFocused();

  // Correction with a reason
  await history.getByRole('button', { name: /Correct record effective 1 Apr 2025/ }).click();
  const correction = page.getByRole('dialog', { name: 'Correct salary record' });
  await correction.getByLabel('Annual salary').fill('2150000');
  await correction.getByLabel('Why is this being corrected?').fill('Approved figure was 2.15M');
  await correction.getByRole('button', { name: 'Save correction' }).click();
  await expect(correction).toBeHidden();
  await expect(history.getByRole('row').nth(1)).toContainText('INR 2,150,000.00');

  await page.getByRole('tab', { name: 'Audit trail' }).click();
  await expect(page.getByText('Salary record corrected')).toBeVisible();
  await expect(page.getByText('“Approved figure was 2.15M”')).toBeVisible();
  await expect(page.getByText('Salary period end adjusted')).toBeVisible();
});

test('deactivating an employee keeps history and can be undone', async ({ page }) => {
  await login(page, 'manager');
  await page.goto('/employees?search=EMP-000100');
  await page.locator('tbody a').first().click();
  await page.getByRole('button', { name: 'Deactivate' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason').fill('Resigned');
  await dialog.getByRole('button', { name: 'Deactivate employee' }).click();
  await expect(page.getByText('Inactive', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add salary change' })).toBeDisabled();

  await page.getByRole('button', { name: 'Undo deactivation' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Deactivated by mistake');
  await page.getByRole('button', { name: 'Reactivate employee' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
});

test('HR viewer has read-only access', async ({ page }) => {
  await login(page, 'viewer');
  await expect(page.getByRole('link', { name: 'Import & export' })).toHaveCount(0);
  await page.goto('/employees');
  await expect(page.getByRole('link', { name: 'Add employee' })).toHaveCount(0);
  await page.locator('tbody a').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add salary change' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit details' })).toHaveCount(0);
});

test('analytics compares groups without mixing currencies', async ({ page }) => {
  await login(page, 'viewer');
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'Median salary by department' })).toBeVisible();
  await page.getByRole('radio', { name: 'Country' }).click();
  await page.getByRole('radio', { name: 'Pay currency' }).click();
  await expect(page.getByRole('heading', { name: 'Median salary by country' })).toBeVisible();
  // Local mode: one row per country and pay currency (expats paid in USD stay separate).
  const table = page
    .getByRole('table')
    .filter({ has: page.getByRole('columnheader', { name: 'Currency' }) });
  await expect(table.getByRole('row', { name: /India.*INR/ })).toBeVisible();
  await expect(table.getByRole('row', { name: /India.*USD/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /Median salary moved from/ })).toBeVisible();
});

test('CSV import previews problems, imports valid rows once, and export downloads a CSV', async ({
  page,
}, testInfo) => {
  const code = uniqueCode('CSV');
  const csv = [
    'employee_id,first_name,last_name,email,country,department,job_title,hire_date,salary,currency',
    `${code}-1,Ana,Lima,${code.toLowerCase()}-1@acme.example,US,Engineering,QA Engineer,2026-02-01,98000,USD`,
    `${code}-2,Ben,Okafor,${code.toLowerCase()}-2@acme.example,GB,Finance,Accountant,2026-03-01,"52,000",GBP`,
    `EMP-000001,Dup,Licate,dup-${code.toLowerCase()}@acme.example,US,Engineering,QA Engineer,2026-02-01,98000,USD`,
  ].join('\n');
  const file = testInfo.outputPath('import.csv');
  await (await import('node:fs/promises')).writeFile(file, csv);

  await login(page, 'manager');
  await page.getByRole('link', { name: 'Import & export' }).first().click();
  await page.getByLabel('CSV file').setInputFiles(file);
  await page.getByRole('button', { name: 'Upload and preview' }).click();

  await expect(page.getByRole('heading', { name: /Preview: import.csv/ })).toBeVisible();
  await expect(page.getByText('Ready to import').locator('..')).toContainText('1');
  await expect(page.getByRole('cell', { name: /thousands separators/ })).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Employee EMP-000001 already exists' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Import 1 employees' }).click();
  await page.getByRole('button', { name: 'Import now' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Imported 1 employees from import.csv' }),
  ).toBeVisible();

  await page.goto(`/employees?search=${code}-1`);
  await expect(page.getByText(/Showing 1–1 of 1$/)).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^acme-employees-\d{4}-\d{2}-\d{2}\.csv$/);
  const content = await readFile(await download.path(), 'utf8');
  expect(content.replace(/^\uFEFF/, '').split('\r\n')[0]).toBe(
    'employee_id,first_name,last_name,email,country,department,job_title,status,hire_date,termination_date,salary,currency,salary_effective_from',
  );
  expect(content).toContain(`${code}-1,Ana,Lima`);
});

test.describe('accessibility (axe, WCAG 2.2 AA rules)', () => {
  for (const path of ['/dashboard', '/employees', '/analytics', '/imports', '/employees/new']) {
    test(`${path} has no serious or critical violations`, async ({ page }) => {
      await login(page, 'manager', path);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
    });
  }

  const seriousViolations = async (page: Page) => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    return results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
  };

  test('employee detail, its dialogs and audit tab have no serious or critical violations', async ({
    page,
  }) => {
    await login(page, 'manager', '/employees?search=EMP-000200');
    await page.locator('tbody a').first().click();
    await expect(page.getByRole('table', { name: /Salary history/ })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    await page.getByRole('button', { name: 'Edit details' }).click();
    await expect(page.getByRole('dialog', { name: /Edit/ })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Edit details' })).toBeFocused();

    await page.getByRole('tab', { name: 'Audit trail' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Audit trail' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('a not-found employee page has no serious or critical violations', async ({ page }) => {
    await login(page, 'viewer', '/employees/00000000-0000-7000-8000-000000000000');
    await expect(page.getByText('Employee not found')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('sign-in page has no serious or critical violations', async ({ page }) => {
    await page.goto('/login');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(
      results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
    ).toEqual([]);
  });
});
