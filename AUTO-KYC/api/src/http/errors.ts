import type { ErrorRequestHandler, RequestHandler } from 'express';

/**
 * An error that is safe to show the caller. Anything that is NOT an AppError
 * is treated as a bug and reported generically.
 */
/** One rejected input, named so a form can point at the right box. */
export interface FieldError {
  field: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /**
     * Present on validation failures. The joined `message` stays for callers
     * that only want a sentence (curl, logs); `fields` is what a form needs to
     * mark the offending input rather than dumping one long string above it.
     */
    readonly fields?: readonly FieldError[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
};

/**
 * The single error shape promised by docs/endpoint-contract.md:
 * `{ error: { code, message } }`.
 *
 * Unrecognised errors are logged server-side and reduced to a generic message.
 * Customer-facing copy stays vague on purpose so that failures cannot be used
 * to probe the system (AGENTS.md invariant 9).
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.fields ? { fields: err.fields } : {}),
      },
    });
    return;
  }

  console.error('[kycflow] unhandled error', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
};
