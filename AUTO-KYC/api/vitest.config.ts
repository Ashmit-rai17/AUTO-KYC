import { defineConfig } from 'vitest/config';

// Unit tests only. These must never need a database, so that `npm test` runs
// anywhere. Database-backed tests live in *.integration.test.ts and are run by
// `npm run test:integration`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'test/**/*.integration.test.ts'],
    restoreMocks: true,
  },
});
