import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ImportPreview } from '@acme/shared';
import { ImportWorkflow } from '@/features/imports/import-workflow';
import { mockApi, problem, renderWithProviders } from './utils';

const preview: ImportPreview = {
  id: 'batch-1',
  fileName: 'people.csv',
  status: 'PREVIEWED',
  totalRows: 4,
  validRows: 2,
  invalidRows: 1,
  duplicateRows: 1,
  issues: [
    {
      row: 3,
      column: 'salary',
      message: 'Must be a plain decimal number such as 85000',
      kind: 'invalid',
    },
    {
      row: 4,
      column: 'employee_id',
      message: 'Employee EMP-000001 already exists',
      kind: 'duplicate',
    },
  ],
  issuesTruncated: 0,
  sample: [
    {
      row: 2,
      employeeCode: 'NEW-1',
      name: 'Ana Lima',
      email: 'ana@acme.example',
      country: 'US',
      department: 'Engineering',
      jobTitle: 'QA Engineer',
      hireDate: '2026-02-01',
      salary: '98000',
      currency: 'USD',
    },
  ],
  createdAt: '2026-11-19T10:00:00.000Z',
  expiresAt: '2026-11-19T10:30:00.000Z',
  committedAt: null,
  previouslyImportedAt: null,
};

const csv = 'employee_id,first_name\nNEW-1,Ana\n';

async function uploadFile() {
  await userEvent.upload(
    screen.getByLabelText('CSV file'),
    new File([csv], 'people.csv', { type: 'text/csv' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Upload and preview' }));
}

describe('ImportWorkflow', () => {
  it('uploads the file text, previews problems, and imports only after confirmation', async () => {
    const { calls } = mockApi({
      'POST /imports': { status: 201, body: preview },
      'POST /imports/batch-1/commit': {
        body: { ...preview, status: 'COMMITTED', importedRows: 2 },
      },
    });
    renderWithProviders(<ImportWorkflow />);
    await uploadFile();

    expect(await screen.findByRole('heading', { name: 'Preview: people.csv' })).toBeInTheDocument();
    expect(calls[0]?.body).toEqual({ fileName: 'people.csv', content: csv });
    expect(screen.getByRole('cell', { name: /plain decimal number/ })).toBeInTheDocument();
    expect(
      screen.getByRole('cell', { name: 'Employee EMP-000001 already exists' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Ana Lima')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Duplicates' }));
    expect(screen.queryByRole('cell', { name: /plain decimal number/ })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Import 2 employees' }));
    expect(calls.filter((c) => c.url.pathname.endsWith('/commit'))).toHaveLength(0); // confirmation first
    await userEvent.click(screen.getByRole('button', { name: 'Import now' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Imported 2 employees from people.csv',
    );
  });

  it('explains an expired preview and offers to upload again', async () => {
    mockApi({
      'POST /imports': { status: 201, body: preview },
      'POST /imports/batch-1/commit': problem(
        409,
        'This preview has expired. Upload the file again to re-check it.',
        { slug: 'import-expired' },
      ),
    });
    renderWithProviders(<ImportWorkflow />);
    await uploadFile();
    await userEvent.click(await screen.findByRole('button', { name: 'Import 2 employees' }));
    await userEvent.click(screen.getByRole('button', { name: 'Import now' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This preview has expired');
    await userEvent.click(screen.getByRole('button', { name: 'Upload the file again' }));
    await waitFor(() => expect(screen.getByLabelText('CSV file')).toBeInTheDocument());
  });

  it('cannot be cancelled or reset while the import is being committed', async () => {
    let finish: (value: { body: unknown }) => void = () => {};
    mockApi({
      'POST /imports': { status: 201, body: preview },
      'POST /imports/batch-1/commit': () => new Promise((resolve) => (finish = resolve)),
    });
    renderWithProviders(<ImportWorkflow />);
    await uploadFile();
    await userEvent.click(await screen.findByRole('button', { name: 'Import 2 employees' }));
    await userEvent.click(screen.getByRole('button', { name: 'Import now' }));

    const dialog = await screen.findByRole('dialog');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(dialog).toBeInTheDocument();
    finish({ body: { ...preview, status: 'COMMITTED', importedRows: 2 } });
    expect(await screen.findByRole('status')).toHaveTextContent('Imported 2 employees');
  });

  it('lists each structural problem the server found in the file', async () => {
    mockApi({
      'POST /imports': problem(422, 'The file is not a well-formed CSV table.', {
        errors: [{ path: 'content', message: 'The column "salary" appears more than once.' }],
      }),
    });
    renderWithProviders(<ImportWorkflow />);
    await uploadFile();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The column "salary" appears more than once.',
    );
  });

  it('reports file-level problems from the server (missing columns)', async () => {
    mockApi({ 'POST /imports': problem(422, 'The file is missing required columns: email.') });
    renderWithProviders(<ImportWorkflow />);
    await uploadFile();
    expect(await screen.findByRole('alert')).toHaveTextContent('missing required columns: email');
  });

  it('rejects non-CSV files in the browser', async () => {
    const { fetchMock } = mockApi({});
    renderWithProviders(<ImportWorkflow />);
    await userEvent.upload(screen.getByLabelText('CSV file'), new File(['x'], 'people.xlsx'), {
      applyAccept: false,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Upload and preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('must be a .csv file');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
