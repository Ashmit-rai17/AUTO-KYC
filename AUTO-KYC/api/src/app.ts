import express, { type Express, Router } from 'express';
import type { Config } from './config.js';
import type { Queryable } from './db/pool.js';
import { requireCsrf } from './http/csrf.js';
import { errorHandler, notFound } from './http/errors.js';
import { globalRateLimit } from './http/rate-limit.js';
import { applicationRoutes } from './modules/applications/applications.routes.js';
import { createApplicationsService } from './modules/applications/applications.service.js';
import { createAuthRepo } from './modules/auth/auth.repo.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { createAuthService } from './modules/auth/auth.service.js';
import type { PasswordHasher } from './modules/auth/password.js';
import { healthRoutes } from './modules/health/health.routes.js';

export interface AppDeps {
  config: Config;
  db: Queryable;
  /**
   * Built outside the app because constructing it is async: the decoy digest
   * that keeps login timing flat has to be computed against the live cost
   * parameters at startup.
   */
  hasher: PasswordHasher;
}

/**
 * Builds the Express application from its dependencies rather than reaching
 * for module-level singletons, so tests can supply a fake database.
 *
 * Modules are logical folders inside one codebase, not separate services
 * (docs/architecture.md).
 */
export function createApp({ config, db, hasher }: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');

  if (config.NODE_ENV === 'production') {
    // Behind a reverse proxy: needed for correct client IPs and Secure cookies.
    app.set('trust proxy', 1);
  }

  // Before anything expensive: a request that will be rejected should not get
  // as far as parsing a body or hashing a password.
  app.use(globalRateLimit(config));

  // Documents travel to object storage directly via signed URLs, so request
  // bodies here are small JSON payloads only (AGENTS.md invariant 2).
  app.use(express.json({ limit: '100kb' }));

  // Applies to every state-changing request that carries a session, so routes
  // added later are covered without anyone remembering to opt in (ADR-006).
  app.use(requireCsrf(config));

  // No CORS middleware, deliberately. The front ends reach this API through a
  // same-origin path proxied by Next.js rewrites, so no browser ever needs to
  // send a cross-origin credentialed request — and none is permitted to.
  const repo = createAuthRepo(db);
  const authService = createAuthService({ db, config, hasher, repo });

  const applicationsService = createApplicationsService({ db, config });

  const api = Router();
  api.use(healthRoutes(db));
  api.use(authRoutes({ service: authService, repo, config }));
  api.use(applicationRoutes({ service: applicationsService, repo, config }));
  app.use('/api', api);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
