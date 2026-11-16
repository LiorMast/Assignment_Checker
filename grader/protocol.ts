import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { summarize } from './dom';
import type { FailedRequest, Site } from './fixtures';
import { firstLine, type Grader } from './grader';
import { linkProblems, SERVER_HOST } from './mail-parse';
import { PROTOCOL_C as P } from './protocol-comments';

/**
 * Submission-procedure checks (נוהל הגשת תרגילי בית), run for every exercise by `defineGradeSpec`:
 * only site files in the submission, the two links, and the view link opened on the real server
 * (the mail subject is not graded). Mail data comes from `npm run fetch` (Submission.mail).
 */
export async function checkProtocol(site: Site, g: Grader) {
  const { submission } = site;
  await g.section('נוהל הגשה', async () => {
    await g.check('רק קבצי האתר בהגשה', async () => {
      const extra = site.files.filter((f) => !SITE_FILE.test(f));
      if (extra.length) g.flag(P.UNRELATED_FILES, summarize(extra));
    });

    const mail = submission.mail;
    if (!mail) {
      if (submission.group) g.review('אין נתוני מייל (npm run fetch) – נוהל ההגשה לא נבדק');
      return;
    }
    const group = submission.group ?? submission.id;

    // The mail subject is not graded (comment 101 is retired); the fetch report still lists its problems.
    await g.check('הלינקים במייל לפי הנוהל', async () => {
      const problems = linkProblems({ group, exercise: mail.exercise, viewUrl: mail.viewUrl, zipUrl: mail.zipUrl });
      if (problems.length) g.flag(P.SUBMIT_LINKS, problems.join('; '));
      if (!mail.viewUrl || !mail.zipUrl) g.review('לפי הנוהל הגשה ללא שני הלינקים לא נבדקת – הציון ניתן לפי ה-zip שהתקבל');
    });

    const viewUrl = mail.viewUrl;
    if (!viewUrl || hostOf(viewUrl) !== SERVER_HOST) return; // reported with the links
    await g.check('הלינק לצפייה נפתח בשרת', async () => {
      if (process.env.GRADER_OFFLINE) {
        g.review('הלינק לצפייה לא נבדק בשרת (הרצה עם --offline)');
        return;
      }
      const local = localFailures(site);
      const live = await checkLivePage(site.page, viewUrl, SERVER_HOST);
      if (live.status === 'unreachable') g.review(`השרת ${SERVER_HOST} לא זמין – הלינק לצפייה לא נבדק (${live.detail})`);
      else if (live.status === 'not-open') g.flag(P.LIVE_NOT_OPEN, live.detail);
      else {
        const onlyLive = live.failed.filter((p) => !local.has(p));
        // The course server refuses URLs with "+" (IIS double escaping): c++.png never loads there.
        const plus = onlyLive.some((p) => p.includes('+')) ? ' (שרת הקורס חוסם שמות קבצים עם התו + – יש לשנות את שם הקובץ, למשל cpp.png)' : '';
        if (onlyLive.length) g.flag(P.LIVE_RESOURCES, summarize(onlyLive) + plus);
        // A hand-added zip (manual-submissions/) was chosen by the grader, whatever is on the server.
        const zipHtml = fs.readFileSync(path.join(submission.rootDir!, submission.entry!), 'utf8');
        const similarity = textSimilarity(live.html, zipHtml);
        if (!submission.manual && similarity < 0.9) {
          g.review(`הדף בשרת שונה מהדף שב-zip (דמיון ${Math.round(similarity * 100)}%) – ייתכן שה-zip אינו הגרסה האחרונה; הציון ניתן לפי ה-zip`);
        }
      }
    });
  });
}

/** Files that belong in a static site, plus Visual Studio / IIS project files. Anything else is unrelated. */
export const SITE_FILE =
  /\.(html?|css|js|mjs|json|map|txt|md|png|jpe?g|jfif|gif|svg|webp|ico|avif|bmp|woff2?|ttf|otf|eot|mp3|mp4|webm|ogg|wav|config|sln|slnx|csproj|user|suo|gitignore|editorconfig)$/i;

export type LiveResult =
  | { status: 'unreachable'; detail: string }
  | { status: 'not-open'; detail: string }
  /** `failed`: resources on `host` that did not load, relative to the page's folder; `html`: the page's source. */
  | { status: 'ok'; failed: string[]; html: string };

/**
 * Opens `url` in a new tab of the page's browser and lists what failed to load from `host`.
 * Retries over http when the https connection fails (the course server is sometimes http only).
 */
export async function checkLivePage(page: Page, url: string, host: string): Promise<LiveResult> {
  const candidates = url.startsWith('https://') ? [url, `http://${url.slice('https://'.length)}`] : [url];
  let error = '';
  for (const candidate of candidates) {
    const live = await page.context().newPage();
    const failed: FailedRequest[] = [];
    live.on('requestfailed', (r) => failed.push({ url: r.url(), resourceType: r.resourceType(), error: r.failure()?.errorText }));
    live.on('response', (r) => {
      if (r.status() >= 400) failed.push({ url: r.url(), resourceType: r.request().resourceType(), status: r.status() });
    });
    try {
      const response = await live.goto(candidate, { waitUntil: 'load', timeout: 20_000 });
      if (!response) return { status: 'not-open', detail: `לא התקבלה תשובה מהשרת: ${candidate}` };
      if (response.status() >= 400) return { status: 'not-open', detail: `HTTP ${response.status()}: ${candidate}` };
      await live
        .waitForFunction(() => Array.from(document.images).every((img) => img.complete), undefined, { timeout: 10_000 })
        .catch(() => {});
      const pageUrl = live.url();
      const resources = failed
        .filter((f) => f.resourceType !== 'document' && hostOf(f.url) === hostOf(pageUrl) && hostOf(f.url) === host.toLowerCase())
        .filter((f) => new URL(f.url).pathname.toLowerCase() !== '/favicon.ico')
        .map((f) => relativeTo(pageUrl, f.url));
      const html = await response.text().catch(() => '');
      return { status: 'ok', failed: [...new Set(resources)], html };
    } catch (e) {
      error = firstLine(e);
    } finally {
      await live.close().catch(() => {});
    }
  }
  return { status: 'unreachable', detail: error };
}

/** Share of words two pages have in common (Dice coefficient on whitespace-separated tokens), 0–1. */
export function textSimilarity(a: string, b: string): number {
  const count = (text: string) => {
    const map = new Map<string, number>();
    for (const t of text.replace(/^\uFEFF/, '').split(/\s+/).filter(Boolean)) map.set(t, (map.get(t) ?? 0) + 1);
    return map;
  };
  const [x, y] = [count(a), count(b)];
  const size = (m: Map<string, number>) => [...m.values()].reduce((n, v) => n + v, 0);
  const total = size(x) + size(y);
  if (!total) return 1;
  let common = 0;
  for (const [t, n] of x) common += Math.min(n, y.get(t) ?? 0);
  return (2 * common) / total;
}

/** Resources that failed in the local copy too, relative to the entry page's folder. */
function localFailures(site: Site): Set<string> {
  const entryUrl = site.baseUrl + site.submission.entry!.split('/').map(encodeURIComponent).join('/');
  return new Set(site.failedRequests.filter((f) => f.resourceType !== 'document').map((f) => relativeTo(entryUrl, f.url)));
}

/** Path of `url` relative to the folder of `pageUrl`, decoded ("images/a.png", "../css/s.css"). */
export function relativeTo(pageUrl: string, url: string): string {
  const dir = new URL('.', pageUrl).pathname;
  const target = new URL(url).pathname;
  return safeDecode(path.posix.relative(dir, target) || path.posix.basename(target));
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
