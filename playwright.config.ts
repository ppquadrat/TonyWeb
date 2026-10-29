import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180_000,
  use: {
    baseURL: 'http://localhost:4173/TonyWeb/',
    screenshot: 'only-on-failure',
    viewport: { width: 1400, height: 800 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 800 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1400, height: 800 } } },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/TonyWeb/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
