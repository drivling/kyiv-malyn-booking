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
        include: [
          'src/pages/TransportPage/datasetAdapter.ts',
          'src/pages/LocalTransportPage/stopCatalog.ts',
          'src/pages/LocalTransportPage/tripDeparture.ts',
          'src/components/ProtectedRoute/ProtectedRoute.tsx',
        ],
        thresholds: {
          lines: 70,
          branches: 55,
          functions: 70,
          statements: 70,
        },
      },
    },
  })
);
