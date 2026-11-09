import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.{ts,tsx}'],
    exclude: ['src/**/*.test.ts', 'node_modules', 'dist'],
    environment: 'node',
  },
});
