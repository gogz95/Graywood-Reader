import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    testTimeout: 15000,
    env: {
      NODE_ENV: 'test',
      DB_PATH: path.resolve(process.cwd(), 'data', 'test-manga.db'),
      DISABLE_DISK_SNAPSHOTS: 'true',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), '.'),
    },
  },
});

