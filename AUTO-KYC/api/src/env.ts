import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Load the workspace-root .env before anything reads process.env.
 *
 * Nothing used to do this. config.ts reads process.env directly, the migration
 * CLI looks only in its own working directory (api/, not the root), and the
 * integration tests read process.env too — so the .env the README tells you to
 * create was never read by anything. Following the documented setup produced
 * "Invalid environment configuration. Check these keys: DATABASE_URL".
 *
 * process.loadEnvFile is built into Node, so this costs no dependency
 * (AGENTS.md: stop and ask before adding one). Two properties matter:
 *
 *  - A REAL environment variable always wins. The file only fills gaps, so a
 *    stray .env on a deployed box cannot override the configured environment.
 *  - A missing file is not an error. Production and CI set real variables and
 *    ship no .env at all.
 */
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}
