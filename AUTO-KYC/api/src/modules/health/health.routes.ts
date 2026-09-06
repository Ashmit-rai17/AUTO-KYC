import { Router } from 'express';
import type { Db } from '../../db/pool.js';

/**
 * Operational endpoints. These carry no customer data and no authentication,
 * which is why they are the only routes exempt from the 5-step security
 * checklist in AGENTS.md. They are documented in docs/endpoint-contract.md.
 */
export function healthRoutes(db: Pick<Db, 'query'>): Router {
  const router = Router();

  // Liveness — is the process up? Deliberately does NOT touch PostgreSQL, so
  // an orchestrator does not kill a healthy API just because the database is
  // briefly unreachable.
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness — can this instance actually serve traffic right now?
  router.get('/health/ready', (_req, res) => {
    void db
      .query('SELECT 1')
      .then(() => res.json({ status: 'ready', db: 'up' }))
      .catch(() => res.status(503).json({ status: 'not_ready', db: 'down' }));
  });

  return router;
}
