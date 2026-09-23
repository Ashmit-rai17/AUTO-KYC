import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

/**
 * Find node-pg-migrate's own JS entry point, and run it with THIS node binary.
 *
 * The obvious thing - spawning node_modules/.bin/node-pg-migrate - works on
 * Linux and cannot work on Windows. That path is a shell script with no
 * extension, so CreateProcess has nothing to run it with and spawnSync fails
 * ENOENT. Reaching for the .cmd shim beside it does not help either: since
 * Node 18.20 / 20.12, spawning a .cmd or .bat without shell: true is refused
 * with EINVAL, closing CVE-2024-27980. And shell: true would then need every
 * argument quoted against a path containing spaces.
 *
 * Spawning the entry point directly sidesteps all of it and behaves the same
 * on every platform. The path comes from the package's own bin field rather
 * than being hardcoded, so a future version moving the file cannot break this
 * quietly.
 *
 * Found on Windows, where `npm run db:migrate` - step 4 of the README - failed
 * for everyone. Render never saw it because Render is Linux.
 */
function resolveCli() {
  // Workspace root first: npm hoists there. api/node_modules is the fallback
  // for an install that did not hoist.
  for (const root of [resolve(here, '../../node_modules'), resolve(here, '../node_modules')]) {
    const pkgDir = resolve(root, 'node-pg-migrate');
    const manifest = resolve(pkgDir, 'package.json');
    if (!existsSync(manifest)) continue;

    const { bin } = JSON.parse(readFileSync(manifest, 'utf8'));
    const relative = typeof bin === 'string' ? bin : bin?.['node-pg-migrate'];
    if (!relative) continue;

    const entry = resolve(pkgDir, relative);
    if (existsSync(entry)) return entry;
  }
  return null;
}

const cli = resolveCli();

/**
 * node-pg-migrate is a devDependency, and npm omits those when NODE_ENV is
 * production — which is exactly what a deploy sets. Without this check the
 * failure is a bare `exit 1` with no output, because spawnSync reports ENOENT
 * on `result.error` rather than by throwing. That cost one silent build
 * failure on Render; say what is wrong instead.
 */
if (!cli) {
  console.error('Cannot find node-pg-migrate.');
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

const result = spawnSync(process.execPath, [cli, '-m', 'migrations', ...process.argv.slice(2)], {
  cwd: resolve(here, '..'),
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Could not run node-pg-migrate: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
