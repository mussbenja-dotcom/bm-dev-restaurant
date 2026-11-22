import { defineConfig, devices } from '@playwright/test';

// E2E contra un servidor propio en el 4300 con su base descartable (data/test-e2e): nunca toca el 4100 ni data/local. Requiere npm run build antes.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4300', locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires', trace: 'retain-on-failure' },
  webServer: { command: 'npx cross-env APP_ENV=test DATA_DIR=./data/test-e2e PORT=4300 tsx scripts/test-reset.ts && npx cross-env APP_ENV=test DATA_DIR=./data/test-e2e PORT=4300 tsx server/index.ts', url: 'http://localhost:4300/api/health', reuseExistingServer: false, timeout: 120_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
