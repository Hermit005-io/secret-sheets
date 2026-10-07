import {defineConfig} from '@playwright/test';

// The tests open the built page straight from disk, the way someone would
// open a copy they had saved. Run `npm run build` first.
//
// CHROMIUM_PATH points at an already-installed Chromium, for machines where
// `npx playwright install chromium` has not been run.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
    },
  },
});
