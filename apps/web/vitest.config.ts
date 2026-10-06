import { defineProject } from 'vitest/config';

// Unit tests for pure UI logic (selectors, geometry, formatting). No DOM needed.
export default defineProject({
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  test: { name: 'web', include: ['src/**/*.test.ts'] },
});
