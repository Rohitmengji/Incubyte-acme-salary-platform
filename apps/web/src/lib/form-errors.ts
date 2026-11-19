import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError, errorMessage } from './api';

/**
 * Maps the API's field-level problem details onto form fields (e.g. a 409 "employee ID already
 * exists" lands under the Employee ID input). Returns a form-level message for anything left over.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly string[],
): string | null {
  if (!(error instanceof ApiError)) return errorMessage(error);
  let matched = false;
  for (const { path, message } of error.problem.errors ?? []) {
    if (fields.includes(path)) {
      // Focus the first rejected field so screen readers announce it with its error message.
      setError(path as Path<T>, { type: 'server', message }, { shouldFocus: !matched });
      matched = true;
    }
  }
  if (error.isStaleVersion) return error.message;
  return matched ? null : error.message;
}
