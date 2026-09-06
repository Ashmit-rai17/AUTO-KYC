import type { RequestHandler } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import type { Config } from '../config.js';

/**
 * Rate limiting (ADR-006).
 *
 * The store is in-memory, which means each API instance counts separately. For
 * a single instance — which is all the demonstration runs — that is correct.
 * Behind more than one instance the effective limit multiplies by the instance
 * count, and this must move to a shared store before that happens. Recorded in
 * the ADR rather than left to be discovered.
 */
function base(config: Config, max: number): Partial<Options> {
  return {
    windowMs: config.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // The same envelope as every other error, so a client needs no special
    // case to read it (docs/endpoint-contract.md).
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Try again shortly.',
        },
      });
    },
  };
}

/** Generous ceiling for ordinary traffic. Catches runaway clients, not attacks. */
export function globalRateLimit(config: Config): RequestHandler {
  if (!config.RATE_LIMIT_ENABLED) return (_req, _res, next) => next();
  return rateLimit(base(config, config.GLOBAL_RATE_LIMIT_MAX));
}

/**
 * Login. This is the control that makes online password guessing impractical.
 *
 * Successful logins do not consume the budget: a legitimate person on a shared
 * office address must not be locked out because colleagues signed in first.
 * Only failures count, and only failures are what an attacker generates.
 */
export function loginRateLimit(config: Config): RequestHandler {
  if (!config.RATE_LIMIT_ENABLED) return (_req, _res, next) => next();
  return rateLimit({
    ...base(config, config.AUTH_RATE_LIMIT_MAX),
    skipSuccessfulRequests: true,
  });
}

/**
 * Registration, which counts EVERY request — including the ones that succeed.
 *
 * This differs from login deliberately, and the reason is worth stating
 * because getting it wrong is silent. Registration now always answers 202,
 * whether or not the address was taken (ADR-006). Under
 * skipSuccessfulRequests that means no registration ever counts, and the route
 * has no limit at all — which would leave the enumeration signal freely
 * mineable and mass account creation unthrottled. Since there is no failure
 * response to count, everything has to be counted.
 */
export function registerRateLimit(config: Config): RequestHandler {
  if (!config.RATE_LIMIT_ENABLED) return (_req, _res, next) => next();
  return rateLimit(base(config, config.AUTH_RATE_LIMIT_MAX));
}
