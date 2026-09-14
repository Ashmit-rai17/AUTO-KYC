import { defineConfig } from 'vitest/config';

// Database-backed tests. Require a migrated PostgreSQL and DATABASE_URL:
//   npm run db:up && npm run db:migrate && npm run test:integration
export default defineConfig({
  test: {
    environment: 'node',
    // Populates process.env from the workspace .env, so the documented setup
    // (cp .env.example .env) is enough to run these. Real environment
    // variables still win, which is how CI supplies its own DATABASE_URL.
    setupFiles: ['./src/env.ts'],
    include: ['test/**/*.integration.test.ts'],
    // One shared transaction per file; parallel workers would deadlock.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
