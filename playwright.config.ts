import { defineConfig } from '@playwright/test';

/** Set by `npm run grade -- <exercise>`; unset when running the self-tests. */
const exercise = process.env.GRADER_EXERCISE;

export default defineConfig({
  testDir: './exercises',
  outputDir: './test-results',
  timeout: 90_000,
  retries: 0,
  fullyParallel: true,
  reporter: exercise
    ? [['./grader/reporter.ts'], ['html', { open: 'never', outputFolder: `results/${exercise}/playwright-report` }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'results/selftest-report' }]],
  use: {
    browserName: 'chromium',
    // Students' screens: boxes that fit at 1920px are side by side for the grader too.
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    colorScheme: 'light',
  },
  projects: [
    { name: 'ex1', testMatch: 'ex1/grade.spec.ts' },
    { name: 'selftest', testMatch: '**/selftest.spec.ts' },
  ],
});
