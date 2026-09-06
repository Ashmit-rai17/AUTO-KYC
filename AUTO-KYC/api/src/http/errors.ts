import type { ErrorRequestHandler, RequestHandler } from 'express';

/**
 * An error that is safe to show the caller. Anything that is NOT an AppError
 * is treated as a bug and reported generically.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
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
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  console.error('[kycflow] unhandled error', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
};
