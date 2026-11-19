import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.ts';
import { mapDatabaseError } from '../../src/http/error-handler.ts';

describe('mapDatabaseError', () => {
  // Shapes captured from Prisma 7.10 + @prisma/adapter-pg against PostgreSQL 18.
  const uniqueViolation = {
    code: 'P2002',
    meta: {
      driverAdapterError: {
        cause: {
          originalCode: '23505',
          constraint: { index: 'employee_email_key' },
          kind: 'UniqueConstraintViolation',
        },
      },
    },
  };
  const deferredExclusion = {
    name: 'DriverAdapterError',
    cause: {
      code: '23P01',
      message: 'conflicting key value violates exclusion constraint "compensation_no_overlap_excl"',
    },
  };

  it('maps unique violations to a 409 with the offending field', () => {
    const mapped = mapDatabaseError(uniqueViolation);
    expect(mapped?.status).toBe(409);
    expect(mapped?.errors).toEqual([
      { path: 'email', message: 'An employee with this email already exists' },
    ]);
  });

  it('maps deferred exclusion violations raised at COMMIT to a 409', () => {
    expect(mapDatabaseError(deferredExclusion)?.slug).toBe('salary-period-overlap');
  });

  it('maps missing records and foreign keys, and leaves unknown errors alone', () => {
    expect(mapDatabaseError({ code: 'P2025' })?.status).toBe(404);
    expect(mapDatabaseError({ code: 'P2003' })?.status).toBe(422);
    expect(mapDatabaseError(new Error('boom'))).toBeUndefined();
  });
});

describe('loadConfig', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

  it('uses a plain cookie locally and a Secure __Host- cookie in production', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'development' }).cookie).toEqual({
      name: 'acme_session',
      secure: false,
    });
    expect(loadConfig({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false' }).cookie).toEqual({
      name: '__Host-acme_session',
      secure: true,
    });
  });

  it('parses a comma-separated origin allowlist', () => {
    expect(
      loadConfig({ ...base, WEB_ORIGIN: 'http://a.test, http://b.test' }).allowedOrigins,
    ).toEqual(['http://a.test', 'http://b.test']);
  });

  it('fails fast with a readable message on invalid configuration', () => {
    expect(() => loadConfig({ DATABASE_URL: 'nope' })).toThrow(/DATABASE_URL/);
  });
});
