import { parse } from 'cookie';
import type { Request, Response } from 'express';
import type { Config } from '../config.js';

/**
 * Cookie policy (ADR-001, ADR-005):
 * - httpOnly     script can never read the token, so XSS cannot steal a session
 * - sameSite Lax the browser will not attach it to cross-site POSTs (CSRF)
 * - secure       HTTPS only, outside development
 * - path '/'     one session for the whole API
 *
 * Lax works because the front ends reach the API through a same-origin path
 * proxied by Next.js rewrites, so the cookie is never third-party. The API
 * enables no CORS at all, which means there is no cross-origin credentialed
 * request to defend against in the first place.
 */
function cookieOptions(config: Config) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.NODE_ENV === 'production',
    path: '/',
  };
}

export function setSessionCookie(res: Response, token: string, config: Config): void {
  res.cookie(config.SESSION_COOKIE_NAME, token, {
    ...cookieOptions(config),
    maxAge: config.SESSION_TTL_HOURS * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response, config: Config): void {
  // The attributes must match those the cookie was set with, or the browser
  // keeps the original and the user stays logged in.
  res.clearCookie(config.SESSION_COOKIE_NAME, cookieOptions(config));
}

export function readSessionToken(req: Request, config: Config): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  return parse(header)[config.SESSION_COOKIE_NAME];
}
