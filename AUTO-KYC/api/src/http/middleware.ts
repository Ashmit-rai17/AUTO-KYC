import type { RequestHandler } from 'express';
import type { Config } from '../config.js';
import type { AuthRepo } from '../modules/auth/auth.repo.js';
import type { Role } from '../modules/auth/roles.js';
import { hashSessionToken } from '../modules/auth/tokens.js';
import { readSessionToken } from './cookies.js';
import { AppError } from './errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Present only after requireSession has run. */
    auth?: import('../modules/auth/roles.js').AuthContext;
  }
}

/**
 * Step 1 of the security checklist: authenticate.
 *
 * Every request re-reads the session from PostgreSQL. That is the cost ADR-001
 * accepted in exchange for instant revocation — a deleted or revoked row locks
 * the holder out on their very next request, which a JWT cannot do.
 */
export function requireSession(deps: { repo: AuthRepo; config: Config }): RequestHandler {
  return (req, _res, next) => {
    const token = readSessionToken(req, deps.config);
    if (!token) {
      next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
      return;
    }

    deps.repo
      .findLiveSession(hashSessionToken(token))
      .then((auth) => {
        if (!auth) {
          // Expired, revoked, unknown, or the user has been suspended. The
          // caller is told none of that.
          next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
          return;
        }
        req.auth = auth;
        next();
      })
      .catch(next);
  };
}

/**
 * Step 2: authorize. Must run after requireSession — reaching it without an
 * auth context is a wiring bug, and is treated as a failure rather than a
 * pass.
 */
export function requireRole(...roles: readonly Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
      return;
    }
    if (!roles.includes(req.auth.role)) {
      next(new AppError(403, 'FORBIDDEN', 'You do not have access to this resource'));
      return;
    }
    next();
  };
}
