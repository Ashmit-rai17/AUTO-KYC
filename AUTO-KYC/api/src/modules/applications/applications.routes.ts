import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { AppError } from '../../http/errors.js';
import { requireRole, requireSession } from '../../http/middleware.js';
import { parseBody } from '../../http/validate.js';
import type { AuthRepo } from '../auth/auth.repo.js';
import type { AuthContext } from '../auth/roles.js';
import type { ApplicationsService } from './applications.service.js';
import { PartialPersonalDataSchema } from './personal-data.js';

/**
 * PATCH accepts a subset and MERGES it. Only the keys present are touched,
 * which is what makes a save-as-you-go form possible.
 *
 * `status`, `consentId` and `submittedAt` are absent on purpose. zod strips
 * unknown keys, so a caller who sends `{"status":"verified"}` has it silently
 * discarded rather than honoured — the same mass-assignment defence that stops
 * register from granting itself a role.
 */
const PatchSchema = z.object({
  personalData: PartialPersonalDataSchema,
});

/** Reads the client address for the consent record. */
function clientIp(req: Request): string | null {
  // trust proxy is set in production, so req.ip already accounts for
  // X-Forwarded-For there and ignores it everywhere else.
  return req.ip ?? null;
}

function authOf(req: Request): AuthContext {
  if (!req.auth) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
  }
  return req.auth;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates the path id before it reaches SQL.
 *
 * Two reasons, and the first is a bug rather than tidiness: applications.id is
 * a uuid column, so handing PostgreSQL "banana" raises "invalid input syntax
 * for type uuid" and surfaces as a 500 — an unparseable id would have been an
 * error report instead of a not-found.
 *
 * And the answer is 404, not 400, so that a malformed id, a stranger's
 * application and a genuinely absent one are indistinguishable. A 400 here
 * would let someone tell "that is not an id" from "that is an id, but not
 * yours".
 */
function pathId(req: Request): string {
  const raw: unknown = req.params.id;
  const id = typeof raw === 'string' ? raw : undefined;
  if (!id || !UUID_PATTERN.test(id)) throw notFoundError();
  return id;
}

function notFoundError(): AppError {
  return new AppError(404, 'NOT_FOUND', 'Application not found');
}

export function applicationRoutes(deps: {
  service: ApplicationsService;
  repo: AuthRepo;
  config: Config;
}): Router {
  const router = Router();
  const session = requireSession({ repo: deps.repo, config: deps.config });
  // Applications belong to customers. Staff read them through a case, which
  // carries its own authorisation, never through these routes.
  const customerOnly = [session, requireRole('CUSTOMER')] as const;

  // POST /api/applications — create a draft.
  router.post('/applications', ...customerOnly, (req, res, next) => {
    deps.service
      .create(authOf(req))
      .then((application) => res.status(201).json({ application }))
      .catch(next);
  });

  // GET /api/applications/me — list own.
  router.get('/applications/me', ...customerOnly, (req, res, next) => {
    deps.service
      .listOwn(authOf(req))
      .then((applications) => res.json({ applications }))
      .catch(next);
  });

  // GET /api/applications/:id — view own. Someone else's is a 404.
  //
  // Registered AFTER /applications/me deliberately. Express takes the first
  // match, so declaring :id first would swallow "me" as an id and turn the
  // list route into a guaranteed 404.
  router.get('/applications/:id', ...customerOnly, (req, res, next) => {
    deps.service
      .getOwn(authOf(req), pathId(req))
      .then((application) => res.json({ application }))
      .catch(next);
  });

  // PATCH /api/applications/:id — edit while draft.
  router.patch('/applications/:id', ...customerOnly, (req, res, next) => {
    const body = parseBody(PatchSchema, req.body);
    deps.service
      .patch(authOf(req), pathId(req), body.personalData)
      .then((application) => res.json({ application }))
      .catch(next);
  });

  // POST /api/applications/:id/consent — record consent with its metadata.
  router.post('/applications/:id/consent', ...customerOnly, (req, res, next) => {
    deps.service
      .recordConsent(authOf(req), pathId(req), {
        ipAddress: clientIp(req),
        userAgent: req.get('user-agent') ?? null,
      })
      .then((application) => res.status(201).json({ application }))
      .catch(next);
  });

  // POST /api/applications/:id/submit — draft → submitted.
  router.post('/applications/:id/submit', ...customerOnly, (req, res, next) => {
    deps.service
      .submit(authOf(req), pathId(req))
      .then((application) => res.json({ application }))
      .catch(next);
  });

  return router;
}
