import express, { type Express, Router } from 'express';
import type { Config } from './config.js';
import type { Db } from './db/pool.js';
import { errorHandler, notFound } from './http/errors.js';
import { healthRoutes } from './modules/health/health.routes.js';

export interface AppDeps {
  config: Config;
  db: Pick<Db, 'query'>;
}

/**
 * Builds the Express application from its dependencies rather than reaching
 * for module-level singletons, so tests can supply a fake database.
 *
 * Modules are logical folders inside one codebase, not separate services
 * (docs/architecture.md).
 */
export function createApp({ config, db }: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');

  if (config.NODE_ENV === 'production') {
    // Behind a reverse proxy: needed for correct client IPs and Secure cookies.
    app.set('trust proxy', 1);
  }

  // Documents travel to object storage directly via signed URLs, so request
  // bodies here are small JSON payloads only (AGENTS.md invariant 2).
  app.use(express.json({ limit: '100kb' }));

  const api = Router();
  api.use(healthRoutes(db));
  app.use('/api', api);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
