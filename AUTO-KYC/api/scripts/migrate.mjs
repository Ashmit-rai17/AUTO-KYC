import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Run node-pg-migrate with the workspace .env loaded.
 *
 * Three things forced this wrapper rather than a one-line script:
 *  - node-pg-migrate v9 dropped its dotenv dependency. Its --envPath flag
 *    survives in --help but does nothing, which fails silently.
 *  - The CLI's working directory is api/, so it would never see a .env at the
 *    workspace root anyway.
 *  - Node's --env-file-if-exists would solve it, but that landed in v22.9.0
 *    and package.json declares ">=20.11". process.loadEnvFile is v20.10.0, so
 *    it holds the line. Plain --env-file is no good: it THROWS when the file
 *    is absent, which is exactly the case in CI and production.
 *
 * Same precedence as src/env.ts: a real environment variable always wins, and
 * a missing file is not an error.
 */
const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '../../.env');

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const bin = resolve(here, '../../node_modules/.bin/node-pg-migrate');
const result = spawnSync(bin, ['-m', 'migrations', ...process.argv.slice(2)], {
  cwd: resolve(here, '..'),
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
