import { defineConfig } from 'vitest/config';

export default defineConfig({
  // World meshing tests build full island LODs; give them headroom on a busy machine.
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000 },
});
