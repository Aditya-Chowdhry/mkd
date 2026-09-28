import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', timeout: 30000, workers: 1,
  testMatch: '**/*.test.js',
  reporter: 'list', use: { trace: 'retain-on-failure' },
});
