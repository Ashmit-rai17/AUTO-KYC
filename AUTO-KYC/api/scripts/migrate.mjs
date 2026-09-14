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

/**
 * node-pg-migrate is a devDependency, and npm omits those when NODE_ENV is
 * production — which is exactly what a deploy sets. Without this check the
 * failure is a bare `exit 1` with no output, because spawnSync reports ENOENT
 * on `result.error` rather than by throwing. That cost one silent build
 * failure on Render; say what is wrong instead.
 */
if (!existsSync(bin)) {
  console.error(`Cannot find node-pg-migrate at ${bin}.`);
  console.error(
    'It is a devDependency, so `npm ci` omits it when NODE_ENV=production.\n' +
      'Install with dev dependencies included: npm ci --include=dev',
  );
  process.exit(1);
}

if (!process.env['DATABASE_URL']) {
  console.error('DATABASE_URL is not set, and no .env was found at the workspace root.');
  console.error('Set it in the environment, or copy .env.example to .env for local work.');
  process.exit(1);
}

const result = spawnSync(bin, ['-m', 'migrations', ...process.argv.slice(2)], {
  cwd: resolve(here, '..'),
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Could not run node-pg-migrate: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
