import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  fullyParallel: true,
  workers: 2,
  use: { baseURL: process.env.TEST_URL || 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  webServer: process.env.TEST_URL
    ? undefined
    : {
        command: process.env.CI ? 'npm run preview -- --port 3000' : 'npm run dev',
        url: 'http://127.0.0.1:3000',
        reuseExistingServer: !process.env.CI,
      },
});
