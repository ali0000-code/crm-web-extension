import { defineConfig } from '@playwright/test';
import path from 'path';

const AUTH_FILE = path.join(__dirname, 'tests', 'auth', 'facebook-session.json');

export default defineConfig({
  testDir: './tests/selectors',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    storageState: AUTH_FILE,
    headless: false,
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'messenger',
      testMatch: 'messenger.spec.ts',
      use: {
        baseURL: 'https://www.facebook.com/messages',
      },
    },
    {
      name: 'groups',
      testMatch: 'groups.spec.ts',
      use: {
        baseURL: 'https://www.facebook.com',
      },
    },
  ],
});
