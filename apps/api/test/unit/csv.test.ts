import { describe, expect, it } from 'vitest';
import {
  escapeCsvCell,
  normaliseHeader,
  parseCsv,
  toCsvLine,
} from '../../src/modules/imports/csv.ts';

describe('parseCsv', () => {
  it('normalises headers and trims cells', () => {
    const { headers, rows } = parseCsv('Employee ID, First Name ,EMAIL\n EMP-1 , Asha ,a@x.io\n');
    expect(headers).toEqual(['employee_id', 'first_name', 'email']);
    expect(rows).toEqual([{ employee_id: 'EMP-1', first_name: 'Asha', email: 'a@x.io' }]);
  });

  it('handles a UTF-8 BOM, CRLF line endings, quoted commas and blank lines', () => {
    const { rows } = parseCsv('\uFEFFname,note\r\n"Sharma, Priya","said ""hi"""\r\n\r\n,\r\n');
    expect(rows).toEqual([{ name: 'Sharma, Priya', note: 'said "hi"' }]);
  });

  it('detects semicolon-delimited files exported by European Excel', () => {
    expect(parseCsv('a;b\n1;2\n').rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('maps header variants to the same column', () => {
    expect(normaliseHeader(' job-title ')).toBe('job_title');
    expect(normaliseHeader('Salary Effective From')).toBe('salary_effective_from');
  });
});

describe('escapeCsvCell', () => {
  it.each(['=SUM(A1:A9)', '+1', '-1+2', '@cmd', '\tx'])(
    'neutralises formula-looking value %j',
    (value) => {
      expect(escapeCsvCell(value).replace(/^"|"$/g, '').startsWith("'")).toBe(true);
    },
  );

  it('quotes values containing delimiters, quotes or newlines', () => {
    expect(escapeCsvCell('Sharma, Priya')).toBe('"Sharma, Priya"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell("O'Brien")).toBe("O'Brien");
    expect(escapeCsvCell(null)).toBe('');
  });

  it('builds CRLF-terminated lines', () => {
    expect(toCsvLine(['a', 1, null])).toBe('a,1,\r\n');
  });

  it('round-trips through the parser', () => {
    const line = toCsvLine(['=1+1', 'Sharma, Priya']);
    expect(parseCsv(`a,b\r\n${line}`).rows[0]).toEqual({ a: "'=1+1", b: 'Sharma, Priya' });
  });
});
