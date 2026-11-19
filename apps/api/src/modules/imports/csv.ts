import Papa from 'papaparse';

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
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
  return { headers: result.meta.fields ?? [], rows: result.data };
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
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsvLine(values: (string | number | null | undefined)[]): string {
  return `${values.map(escapeCsvCell).join(',')}\r\n`;
}
