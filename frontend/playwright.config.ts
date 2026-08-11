import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against Vite dev server (fast, no prerender build).
 * API is mocked via page.route — no live backend.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4177',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 4177',
    url: 'http://127.0.0.1:4177',
    // Always start our own server — avoid reusing an unrelated process on the port.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
