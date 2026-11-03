import { test as base, type Page, type TestInfo } from '@playwright/test';
import path from 'node:path';
import { firstLine, Grader } from './grader';
import { listFiles, toPosix } from './prepare';
import { serveDir } from './server';
import type { Submission } from './types';

export interface FailedRequest {
  url: string;
  resourceType: string;
  status?: number;
  error?: string;
}

/** A student's page, opened in the browser. */
export interface Site {
  page: Page;
  submission: Submission;
  /** URL of the submission root, e.g. http://127.0.0.1:41234/ */
  baseUrl: string;
  /** Every file in the submission, relative to its root, with forward slashes. */
  files: string[];
  failedRequests: FailedRequest[];
  /** Requests that only worked because the server ignored upper/lower case. */
  caseMismatches: { requested: string; actual: string }[];
  /** Adds a stylesheet from the submission (used when the student's <link> is broken). */
  injectCss(file: string): Promise<void>;
  close(): Promise<void>;
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Serves the submission, opens its entry page and attaches a full-page screenshot. */
export async function openSite(page: Page, submission: Submission, info: TestInfo): Promise<Site> {
  const rootDir = submission.rootDir!;
  const server = await serveDir(rootDir);
  const baseUrl = `${server.url}/`;
  const failedRequests: FailedRequest[] = [];
  const caseMismatches: Site['caseMismatches'] = [];
  page.on('requestfailed', (request) =>
    failedRequests.push({ url: request.url(), resourceType: request.resourceType(), error: request.failure()?.errorText }),
  );
  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400) failedRequests.push({ url: response.url(), resourceType: response.request().resourceType(), status });
    const actual = response.headers()['x-case-mismatch'];
    if (actual) caseMismatches.push({ requested: safeDecode(new URL(response.url()).pathname.slice(1)), actual: safeDecode(actual) });
  });

  try {
    await page.goto(baseUrl + encodePath(submission.entry!), { waitUntil: 'load', timeout: 30_000 });
    await settle(page);
    const shot = info.outputPath('screenshot.jpg');
    try {
      await page.screenshot({ path: shot, fullPage: true, type: 'jpeg', quality: 75 });
      await info.attach('screenshot', { path: shot, contentType: 'image/jpeg' });
    } catch (error) {
      console.warn(`screenshot failed for ${submission.id}: ${firstLine(error)}`);
    }
  } catch (error) {
    await server.close();
    throw error;
  }

  return {
    page,
    submission,
    baseUrl,
    files: listFiles(rootDir).map((f) => toPosix(path.relative(rootDir, f))),
    failedRequests,
    caseMismatches,
    async injectCss(file) {
      await page.addStyleTag({ url: baseUrl + encodePath(file) });
      await settle(page);
    },
    close: () => server.close(),
  };
}

/** Waits until images (including lazy ones) and fonts are done. */
async function settle(page: Page) {
  await page.evaluate(() =>
    document.querySelectorAll<HTMLImageElement>('img[loading="lazy"]').forEach((img) => (img.loading = 'eager')),
  );
  await page
    .waitForFunction(() => Array.from(document.images).every((img) => img.complete), undefined, { timeout: 10_000 })
    .catch(() => {}); // a slow external image is reported as broken, not as a crash
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

export const test = base.extend<{ submission: Submission; g: Grader; site: Site }>({
  submission: [{ id: '', source: '' }, { option: true }],

  g: async ({ submission }, use, info) => {
    const g = new Grader(info);
    await use(g);
    if (!g.completed) {
      const why = info.errors[0]?.message ? firstLine(info.errors[0].message) : info.status;
      g.review(`הבדיקה האוטומטית לא הושלמה: ${why}`, { fatal: true });
    }
    await info.attach('grader-result', { body: JSON.stringify(g.result(submission)), contentType: 'application/json' });
  },

  site: async ({ page, submission }, use, info) => {
    const site = await openSite(page, submission, info);
    await use(site);
    await site.close();
  },
});

export { expect } from '@playwright/test';
