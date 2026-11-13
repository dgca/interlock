import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/browser/*.browser.ts'],
    globalSetup: ['tests/browser/gallery-build.ts'],
    testTimeout: 20_000,
  },
});
