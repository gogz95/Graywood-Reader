import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), '.'),
    },
  },
});
