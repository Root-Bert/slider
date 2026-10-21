import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'api',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // The data key for the encrypted columns (BER-149).
    setupFiles: ['test/setup-data-key.ts'],
    // Runs the migrations once for the whole run; each test copies the result.
    globalSetup: ['test/global-database.ts'],
    // Each test boots its own in-memory Postgres (PGlite); give it room on slow machines.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
