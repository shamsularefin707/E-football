import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/unit/**/*.test.ts'], testTimeout: 180000 },
} as never);
