import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { clearSessionCookie, setSessionCookie } from '../../http/cookies.js';
import { AppError } from '../../http/errors.js';
import { requireSession } from '../../http/middleware.js';
import { parseBody } from '../../http/validate.js';
import type { AuthRepo } from './auth.repo.js';
import type { AuthService } from './auth.service.js';

/**
 * NIST guidance, not the old composition rules: length is what matters, so
 * there is no "must contain a symbol". The upper bound exists because argon2
 * will faithfully hash a 10 MB string and that is a cheap way to burn the
 * server's memory.
 */
const PasswordSchema = z
  .string()
  .min(12, 'must be at least 12 characters')
  .max(200, 'must be at most 200 characters');

const EmailSchema = z.string().trim().email('must be a valid email address').max(254);

const CredentialsSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
});

/** Login must not apply registration's length rules — they would leak policy. */
const LoginSchema = z.object({
  email: z.string().trim().max(254),
  password: z.string().max(200),
});

export function authRoutes(deps: {
  service: AuthService;
  repo: AuthRepo;
  config: Config;
}): Router {
  const router = Router();
  const session = requireSession({ repo: deps.repo, config: deps.config });

  // POST /api/auth/register — public. Creates a CUSTOMER, and only a CUSTOMER.
  router.post('/auth/register', (req, res, next) => {
    const body = parseBody(CredentialsSchema, req.body);
    deps.service
      .register(body)
      .then((user) => res.status(201).json({ user }))
      .catch(next);
  });

  // POST /api/auth/login — public.
  router.post('/auth/login', (req, res, next) => {
    const body = parseBody(LoginSchema, req.body);
    deps.service
      .login(body)
      .then(({ user, token }) => {
        setSessionCookie(res, token, deps.config);
        // The token goes in the cookie and nowhere else. Returning it in the
        // body would put it somewhere script can read, defeating httpOnly.
        res.json({ user });
      })
      .catch(next);
  });

  // POST /api/auth/logout — any authenticated role.
  router.post('/auth/logout', session, (req, res, next) => {
    if (!req.auth) {
      next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
      return;
    }
    deps.service
      .logout(req.auth)
      .then(() => {
        clearSessionCookie(res, deps.config);
        res.status(204).end();
      })
      .catch(next);
  });

  // GET /api/auth/me — any authenticated role.
  router.get('/auth/me', session, (req, res, next) => {
    if (!req.auth) {
      next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
      return;
    }
    res.json({
      user: { id: req.auth.userId, email: req.auth.email, role: req.auth.role },
    });
  });

  return router;
}
