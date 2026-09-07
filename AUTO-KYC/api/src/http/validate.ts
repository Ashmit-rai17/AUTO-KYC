import type { z } from 'zod';
import { AppError } from './errors.js';

/**
 * Step 4 of the security checklist.
 *
 * Note on invariant 9: field-level detail is returned HERE, and that is not a
 * contradiction. Invariant 9 is about not revealing whether an account or a
 * verification outcome exists — telling a caller that their password is too
 * short reveals nothing about anyone else, and withholding it would make the
 * form unusable. Vagueness belongs on authentication and verification results,
 * not on the shape of the request.
 */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;

  const fields = parsed.error.issues.map((issue) => ({
    field: issue.path.join('.') || '(body)',
    message: issue.message,
  }));

  throw new AppError(
    400,
    'VALIDATION_ERROR',
    `Invalid request: ${fields.map((f) => `${f.field} ${f.message}`).join('; ')}`,
    fields,
  );
}
