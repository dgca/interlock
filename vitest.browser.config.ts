import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/browser/*.browser.ts'], testTimeout: 20_000 },
});
