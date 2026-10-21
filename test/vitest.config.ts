import { defineProject } from 'vitest/config';

// Checks of the self-hosting setup itself: CI workflows, Dockerfile, Caddy, compose and the docs
// that describe them (the code they configure is tested in its own project).
export default defineProject({
  test: { name: 'infra', include: ['**/*.test.ts'], environment: 'node' },
});
