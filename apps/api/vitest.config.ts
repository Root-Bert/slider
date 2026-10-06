import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'api',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Each test boots its own in-memory Postgres (PGlite); give it room on slow machines.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
