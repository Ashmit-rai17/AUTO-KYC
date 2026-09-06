import type { Server } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/pool.js';
import { createPasswordHasher } from './modules/auth/password.js';

const config = loadConfig();
const db = createDb(config);

// Startup is async because the password hasher precomputes a decoy digest
// against the configured cost parameters.
const hasher = await createPasswordHasher(config);
const app = createApp({ config, db, hasher });

const server: Server = app.listen(config.PORT, () => {
  console.info(`[kycflow] API listening on :${config.PORT} (${config.NODE_ENV})`);
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[kycflow] ${signal} received, shutting down`);

  // Stop accepting connections, drain the pool, then exit.
  server.close(() => {
    void db
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });

  // Do not hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
