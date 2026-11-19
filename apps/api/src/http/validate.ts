import type { z } from 'zod';
import { ValidationError } from './errors.ts';

/** Parses untrusted input (body, query, params) and throws a 400 with field-level messages. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ValidationError(
    result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.') || '(root)',
      message: issue.message,
    })),
  );
}
