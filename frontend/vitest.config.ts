import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      setupFiles: ['./src/test/setup.ts'],
      coverage: {
        provider: 'v8',
        include: ['src/pages/TransportPage/datasetAdapter.ts'],
        thresholds: {
          lines: 80,
          branches: 70,
          functions: 80,
          statements: 80,
        },
      },
    },
  })
);
