import { randomBytes, timingSafeEqual } from 'node:crypto';
import { parse } from 'cookie';
import type { Request, RequestHandler, Response } from 'express';
import type { Config } from '../config.js';
import { AppError } from './errors.js';

/** Name of the readable companion to the session cookie. */
export const CSRF_COOKIE = 'kyc_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF (ADR-006).
 *
 * Unlike the session cookie this one is deliberately NOT httpOnly: the front
 * end has to read it in order to echo it back in a header. That is safe
 * because the token is not a credential on its own — it proves only that the
 * caller could read a cookie on our origin, which a cross-site attacker
 * cannot do.
 */
export function issueCsrfToken(res: Response, config: Config): string {
  const token = randomBytes(32).toString('base64url');
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    path: '/',
    maxAge: config.SESSION_TTL_HOURS * 60 * 60 * 1000,
  });
  return token;
}

export function clearCsrfToken(res: Response, config: Config): void {
  res.clearCookie(CSRF_COOKIE, {
    httpOnly: false,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    path: '/',
  });
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  return header ? parse(header)[name] : undefined;
}

/** Constant-time comparison that tolerates unequal lengths. */
function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Requires a matching token on any state-changing request that carries a
 * session.
 *
 * The gate is "does this request carry a session cookie", not a list of exempt
 * paths. CSRF is only meaningful when the browser would attach credentials on
 * the attacker's behalf; with no session cookie there is nothing to abuse, so
 * login and register pass through without needing to be named. Nothing to keep
 * in sync as routes are added.
 *
 * This is defence in depth rather than the primary control. SameSite=Lax
 * already stops a cross-site POST from carrying the cookie, and the API
 * enables no CORS. This covers the case where one of those assumptions turns
 * out to be wrong.
 */
export function requireCsrf(config: Config): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const hasSession = readCookie(req, config.SESSION_COOKIE_NAME) !== undefined;
    if (!hasSession) {
      next();
      return;
    }

    const cookieToken = readCookie(req, CSRF_COOKIE);
    const headerToken = req.get(CSRF_HEADER);

    if (!cookieToken || !headerToken || !sameToken(cookieToken, headerToken)) {
      next(
        new AppError(403, 'CSRF_FAILED', 'Request could not be verified. Reload and try again.'),
      );
      return;
    }

    next();
  };
}
