import { defineProject } from 'vitest/config';

// Component tests (`*.test.tsx`) render React into happy-dom. Pure logic stays in the node
// project (vitest.config.ts) so it runs fast and never depends on a DOM by accident.
export default defineProject({
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  test: {
    name: 'web-dom',
    // Dates format in the local zone; tests assert calendar days, so they pin one.
    env: { TZ: 'Europe/Berlin' },
    environment: 'happy-dom',
    include: ['src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup-dom.ts'],
  },
});
