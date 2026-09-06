import { defineConfig } from 'vitest/config';

// Database-backed tests. Require a migrated PostgreSQL and DATABASE_URL:
//   npm run db:up && npm run db:migrate && npm run test:integration
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.integration.test.ts'],
    // One shared transaction per file; parallel workers would deadlock.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
