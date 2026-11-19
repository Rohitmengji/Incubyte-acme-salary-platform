import Papa from 'papaparse';

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  /** Structural problems that make the file ambiguous (duplicate columns, broken quoting, ragged rows). */
  problems: string[];
}

/** "Employee ID", " employee-id " and "EMPLOYEE_ID" all become "employee_id". */
export function normaliseHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/**
 * Parses spreadsheet CSV exports: strips a UTF-8 BOM, accepts CRLF, auto-detects , or ; delimiters
 * (European Excel), ignores blank lines and trims cells.
 */
export function parseCsv(content: string): ParsedCsv {
  const text = content.replace(/^\uFEFF/, '');
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: normaliseHeader,
    transform: (value) => value.trim(),
  });
  const problems: string[] = [];
  // PapaParse silently renames a repeated column ("salary" -> "salary_1"); importing either copy
  // would be a guess, so the file is rejected instead.
  const renamed = (result.meta as { renamedHeaders?: Record<string, string> | null })
    .renamedHeaders;
  for (const original of new Set(Object.values(renamed ?? {}))) {
    if (original) problems.push(`The column "${original}" appears more than once.`);
  }
  for (const error of result.errors) {
    if (error.type === 'Delimiter') continue; // a one-column file has no delimiter to detect
    if (error.type === 'Quotes') {
      // PapaParse's row number for quoting errors is not reliable, so none is given.
      problems.push('A quoted value is never closed. Check the file for a stray " character.');
    } else {
      // `row` is the 0-based data row; the header is spreadsheet row 1.
      const where = error.row === undefined ? '' : `Row ${error.row + 2}: `;
      problems.push(`${where}${error.message}.`);
    }
  }
  return { headers: result.meta.fields ?? [], rows: result.data, problems };
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Makes a value safe to open in Excel/Sheets: cells starting with formula characters are prefixed
 * with an apostrophe (CSV/formula injection), then quoted per RFC 4180 when needed.
 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  // ';' is quoted too: Excel in locales whose list separator is ';' would otherwise split the cell
  // and could start a new cell with a formula.
  return /[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsvLine(values: (string | number | null | undefined)[]): string {
  return `${values.map(escapeCsvCell).join(',')}\r\n`;
}
