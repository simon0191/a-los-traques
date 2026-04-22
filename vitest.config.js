import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests still live at the repo root under tests/ during the monorepo transition;
    // per RFC 0019 §9 they split into package-colocated __tests__/ in later phases.
    include: ['tests/**/*.test.js'],
  },
});
