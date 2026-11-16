import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { describeColor, isGray, isTransparent, isWhite } from './colors';
import type { Comment } from './comments';
import { summarize, toRgba, type Rect } from './dom';
import type { Site } from './fixtures';
import type { Grader } from './grader';

/**
 * Checks shared by several exercises (the same rule, step title and logic in each).
 * Every function takes the comments it may give from the calling exercise's own table,
 * so the numbers are that exercise's: `checkInlineStyles(page, g, C)` with the exercise's `C`.
 */
type Comments<K extends string> = Record<K, Comment>;

/** The entry page should be index.html (otherwise the folder link on the server shows no page). */
export function checkMainFileName(site: Site, g: Grader, C: Comments<'MAIN_FILE_NAME'>) {
  return g.check('שם הקובץ הראשי index.html', async () => {
    const name = site.submission.entry!.split('/').pop()!;
    if (name.toLowerCase() !== 'index.html') g.flag(C.MAIN_FILE_NAME, `שם הקובץ: ${name}`);
  });
}

export function checkInlineStyles(page: Page, g: Grader, C: Comments<'INLINE_FEW' | 'INLINE_MANY'>) {
  return g.check('ללא עיצוב inline', async () => {
    const tags = await page
      .locator('[style]')
      .evaluateAll((els) => els.filter((el) => el.getAttribute('style')!.trim() !== '').map((el) => `<${el.tagName.toLowerCase()}>`));
    const detail = `${tags.length} אלמנטים: ${summarize(tags)}`;
    if (tags.length >= 4) g.flag(C.INLINE_MANY, detail);
    else if (tags.length) g.flag(C.INLINE_FEW, detail);
  });
}

export function checkBackslashPaths(page: Page, g: Grader, C: Comments<'PATH_BACKSLASH'>) {
  return g.check('נתיבים עם / ולא \\', async () => {
    const paths = await page
      .locator('[src], [href]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('src') ?? el.getAttribute('href') ?? ''));
    // Absolute paths to the student's computer are reported with the broken images/stylesheet.
    const backslash = paths.filter((p) => p.includes('\\') && !/^(file:|[a-z]:\\)/i.test(p.trim()));
    if (backslash.length) g.flag(C.PATH_BACKSLASH, summarize(backslash.map((p) => p.trim())));
  });
}

/** Right-to-left direction on `selector` (the page wrapper, or body). */
export function checkRtl(page: Page, g: Grader, C: Comments<'NO_RTL'>, selector: string) {
  return g.check('כיוון מימין לשמאל (rtl)', async () => {
    const direction = await page.locator(selector).first().evaluate((el) => getComputedStyle(el).direction);
    if (direction !== 'rtl') {
      const onHead = await page.evaluate(() => document.head?.getAttribute('dir')?.toLowerCase() === 'rtl');
      g.flag(C.NO_RTL, onHead ? 'dir="rtl" הוגדר על תגית head, שאינה מוצגת ולכן אין לו השפעה' : `direction: ${direction}`);
    }
  });
}

export function checkDuplicateIds(page: Page, g: Grader, C: Comments<'DUPLICATE_ID'>) {
  return g.check('id ייחודי לכל אלמנט', async () => {
    const duplicates = await page.locator('[id]').evaluateAll((els) => {
      const counts = new Map<string, number>();
      for (const el of els) if (el.id) counts.set(el.id, (counts.get(el.id) ?? 0) + 1);
      return [...counts].filter(([, n]) => n > 1).map(([id, n]) => `"${id}" ×${n}`);
    });
    if (duplicates.length) g.flag(C.DUPLICATE_ID, summarize(duplicates));
  });
}

export function checkSkeleton(page: Page, g: Grader, C: Comments<'SKELETON'>) {
  return g.check('שלד הדף (DOCTYPE, meta charset, title)', async () => {
    const s = await page.evaluate(() => ({
      doctype: document.compatMode === 'CSS1Compat',
      charset: !!document.querySelector('meta[charset], meta[http-equiv="content-type" i]'),
      title: document.title.trim() !== '',
    }));
    const missing = [!s.doctype && '<!DOCTYPE html>', !s.charset && '<meta charset="utf-8">', !s.title && '<title>'].filter(Boolean);
    if (missing.length) g.flag(C.SKELETON, `חסר: ${missing.join(', ')}`);
  });
}

/**
 * The student's own stylesheet: linked, loaded, not empty, named style.css.
 * A broken link is fixed by adding the file ourselves, so the design is still graded.
 * `ignore`: links that aren't the student's own CSS (e.g. a downloaded copy of Bootstrap).
 */
export async function checkStylesheet(
  site: Site,
  g: Grader,
  C: Comments<'CSS_FILE_NAME' | 'CSS_LINK_BROKEN' | 'NO_EXTERNAL_CSS'>,
  options: { ignore?: (href: string) => boolean } = {},
) {
  const { page } = site;
  const { links, styleTags } = await page.evaluate(() => ({
    links: Array.from(document.querySelectorAll<HTMLLinkElement>('link'))
      .filter((link) => /stylesheet/i.test(link.rel))
      .map((link) => {
        let rules = -1; // not loaded
        try {
          if (link.sheet) rules = link.sheet.cssRules.length;
        } catch {
          rules = -2; // cross-origin, e.g. a CDN: not the student's own file
        }
        return { attr: link.getAttribute('href') ?? '', href: link.href, rules };
      }),
    styleTags: Array.from(document.querySelectorAll('style')).filter((s) => (s.textContent ?? '').trim() !== '').length,
  }));
  const failed = new Set(site.failedRequests.map((r) => r.url));
  const origin = new URL(site.baseUrl).origin;
  const ignored = (file: string) => !!options.ignore?.(file);
  const own = links.filter((l) => (l.href.startsWith(origin) || !/^https?:/i.test(l.href)) && !ignored(l.href));
  const loaded = own.filter((l) => l.rules >= 0 && !failed.has(l.href));
  const withRules = loaded.filter((l) => l.rules > 0);

  if (withRules.length) {
    const names = withRules.map((l) => decodeURIComponent(new URL(l.href).pathname.split('/').pop() ?? ''));
    if (!names.some((n) => n.toLowerCase() === 'style.css')) g.flag(C.CSS_FILE_NAME, `שם הקובץ: ${summarize(names)}`);
    return;
  }

  // The student's CSS exists but isn't applied: apply it ourselves so the design is still graded.
  const broken = own.filter((l) => !loaded.includes(l));
  const cssFiles = site.files.filter(
    (f) => /\.css$/i.test(f) && !ignored(f) && fs.readFileSync(path.join(site.submission.rootDir!, f), 'utf8').trim() !== '',
  );
  if (cssFiles.length && (broken.length || !styleTags)) {
    const file = pickCssFile(cssFiles, broken.map((l) => l.attr));
    await site.injectCss(file);
    const link = broken[0] ?? loaded[0];
    const why = !link
      ? 'לא נמצאה תגית <link> לקובץ'
      : `href="${link.attr}"` +
        (loaded.includes(link) ? ' (קובץ ריק)' : /^(file:|[a-z]:[\\/])/i.test(link.attr) ? ' (נתיב מוחלט למחשב שלכם)' : '');
    g.flag(C.CSS_LINK_BROKEN, `${why}, הקובץ בהגשה: ${file}`);
    if (file.split('/').pop()!.toLowerCase() !== 'style.css') g.flag(C.CSS_FILE_NAME, `שם הקובץ: ${file}`);
    return;
  }

  if (styleTags) g.flag(C.NO_EXTERNAL_CSS, 'העיצוב נכתב בתגית <style> בתוך הדף');
  else if (loaded.length) g.flag(C.NO_EXTERNAL_CSS, 'קובץ ה-CSS המקושר ריק');
  else g.flag(C.NO_EXTERNAL_CSS, 'לא נמצא קובץ CSS בהגשה');
}

/** Prefers the file the broken <link> pointed at, then style.css. */
function pickCssFile(files: string[], hrefs: string[]): string {
  const name = (p: string) => p.split(/[\\/]/).pop()!.toLowerCase();
  const wanted = new Set(hrefs.map(name));
  return files.find((f) => wanted.has(name(f))) ?? files.find((f) => name(f) === 'style.css') ?? files[0];
}

/** Every image shows, isn't stretched, sits in the images folder, and its path matches the file name's case. */
export async function checkImages(
  site: Site,
  g: Grader,
  C: Comments<'IMG_BROKEN_ONE' | 'IMG_BROKEN_MANY' | 'IMG_STRETCHED' | 'NO_IMAGES_FOLDER' | 'PATH_CASE'>,
) {
  const { page } = site;
  const images = await page.locator('img').evaluateAll((els) =>
    els.map((el) => {
      const img = el as HTMLImageElement;
      return {
        src: img.getAttribute('src') ?? '',
        url: img.currentSrc || img.src,
        loaded: img.complete && img.naturalWidth > 0,
        width: img.width,
        height: img.height,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        fit: getComputedStyle(img).objectFit,
      };
    }),
  );
  const failed = new Set(site.failedRequests.map((r) => r.url));
  const isSvg = (url: string) => /\.svg([?#]|$)/i.test(url);
  const broken = images.filter((i) => i.src.trim() === '' || failed.has(i.url) || !(i.loaded || isSvg(i.url)));
  const working = images.filter((i) => !broken.includes(i));

  await g.check('כל התמונות מוצגות', async () => {
    const why = (i: (typeof images)[number]) =>
      i.src.trim() === '' ? '(src ריק)' : /^(file:|[a-z]:[\\/])/i.test(i.src) ? `${i.src} (נתיב מוחלט למחשב שלכם)` : i.src;
    if (broken.length === 1) g.flag(C.IMG_BROKEN_ONE, why(broken[0]));
    else if (broken.length > 1) g.flag(C.IMG_BROKEN_MANY, `${broken.length} תמונות: ${summarize(broken.map(why))}`);
  });
  await g.check('התמונות אינן מעוותות', async () => {
    const stretched = working.filter(
      (i) =>
        i.width > 8 &&
        i.height > 8 &&
        i.naturalHeight > 0 &&
        !['contain', 'cover', 'scale-down'].includes(i.fit) &&
        Math.abs(i.width / i.height / (i.naturalWidth / i.naturalHeight) - 1) > 0.08,
    );
    if (stretched.length) g.flag(C.IMG_STRETCHED, summarize(stretched.map((i) => i.src)));
  });
  await g.check('התמונות בתיקייה images', async () => {
    const origin = new URL(site.baseUrl).origin;
    const outside = working.filter(
      (i) => i.url.startsWith(origin) && !decodeURI(new URL(i.url).pathname).toLowerCase().split('/').includes('images'),
    );
    // Images linked from the internet aren't part of the site (and disappear when that site changes).
    const external = working.filter((i) => /^https?:/i.test(i.url) && !i.url.startsWith(origin));
    const listed = [...outside.map((i) => i.src), ...external.map((i) => `${i.src} (תמונה מהאינטרנט)`)];
    if (listed.length) g.flag(C.NO_IMAGES_FOLDER, summarize(listed));
  });
  await g.check('אותיות גדולות/קטנות בנתיבים', async () => {
    // Show paths as the student wrote them: relative to the page's folder.
    const pageDir = site.submission.entry!.split('/').slice(0, -1).join('/');
    const relative = (p: string) => (pageDir && p.startsWith(`${pageDir}/`) ? p.slice(pageDir.length + 1) : p);
    const mismatches = site.caseMismatches.map((m) => `כתוב "${relative(m.requested)}" אך שם הקובץ "${relative(m.actual)}"`);
    if (mismatches.length) g.flag(C.PATH_CASE, summarize(mismatches, 3));
  });
}

/** Gray background on the region (or its heading) and white text in its heading. */
export async function grayWithWhiteText(page: Page, region: string, notGray: Comment, notWhite: Comment, g: Grader) {
  const s = await page
    .locator(region)
    .first()
    .evaluate((el) => {
      const heading = el.matches('h1, h2, h3, h4, h5, h6') ? el : el.querySelector('h1, h2, h3, h4, h5, h6');
      return {
        background: getComputedStyle(el).backgroundColor,
        // Colors of a gradient background (computed values are rgb()/rgba()).
        gradient: getComputedStyle(el).backgroundImage.includes('gradient(')
          ? getComputedStyle(el).backgroundImage.match(/rgba?\([^)]*\)/g) ?? []
          : [],
        headingBackground: heading ? getComputedStyle(heading).backgroundColor : 'transparent',
        text: getComputedStyle(heading ?? el).color,
      };
    });
  const [background, headingBackground, text, ...gradient] = await toRgba(page, [s.background, s.headingBackground, s.text, ...s.gradient]);
  const grayGradient = gradient.length > 0 && gradient.every(isGray);
  if (!isGray(background) && !isGray(headingBackground) && !grayGradient) {
    const shown = gradient.length
      ? `רקע מדורג (gradient): ${summarize(gradient.map(describeColor))}`
      : `צבע הרקע: ${describeColor(isTransparent(background) ? headingBackground : background)}`;
    g.flag(notGray, shown);
  }
  if (!isWhite(text)) g.flag(notWhite, `צבע הטקסט: ${describeColor(text)}`);
}

/**
 * Last year's solution of the exercise: its header/container/footer divs and course-title h1.
 * `extraClasses`: more class names that only last year's version used (strong signals).
 */
export async function checkLastYear(page: Page, g: Grader, C: Comments<'LAST_YEAR'>, extraClasses: string[] = []) {
  const s = await page.evaluate(
    (extra) => ({
      h1: document.querySelector('h1')?.textContent ?? '',
      h2: Array.from(document.querySelectorAll('h2'), (h) => h.textContent ?? '').join(' '),
      oldClasses: ['width-full', 'footer-images', ...extra].filter((c) => document.querySelector(`.${c}`)),
      containerAndFooter: !!document.querySelector('.container') && !!document.querySelector('.footer'),
      newClasses: ['page-header', 'popular-languages'].some((c) => document.querySelector(`.${c}`)),
    }),
    extraClasses,
  );
  const strong = [/קורס|frontend|צד לקוח/i.test(s.h1) && 'כותרת h1 של השנה שעברה', ...s.oldClasses.map((c) => `המחלקה ${c}`)];
  const weak = [
    /HyperText Markup Language|Cascading Style Sheets|Java Script/i.test(s.h2) && 'כותרות h2 של השנה שעברה',
    s.containerAndFooter && 'המחלקות container ו-footer',
    !s.newClasses && 'חסרות המחלקות page-header ו-popular-languages',
  ];
  const signals = { strong: strong.filter((x): x is string => !!x), weak: weak.filter((x): x is string => !!x) };
  if (signals.strong.length >= 2 || (signals.strong.length >= 1 && signals.weak.length >= 1)) {
    g.flag(C.LAST_YEAR, [...signals.strong, ...signals.weak].join(', '));
    g.review('נראה כמו פתרון של השנה שעברה – כדאי לבדוק ידנית');
  }
}

/** Runs `body` with the viewport `width` px wide (and `height`, default: the same proportions), then restores the size. */
export async function atWidth<T>(page: Page, width: number, body: () => Promise<T>, height?: number): Promise<T> {
  const original = page.viewportSize();
  if (!original) return body();
  await page.setViewportSize({ width, height: height ?? Math.round((width * original.height) / original.width) });
  await page.waitForTimeout(100);
  try {
    return await body();
  } finally {
    await page.setViewportSize(original);
    await page.waitForTimeout(100);
  }
}

/**
 * How far visible content (text, images, tables) sticks out of each box matched by `selector`, in px.
 * Boxes that clip or scroll their content (overflow other than visible) and inline boxes are skipped.
 */
export function boxOverflow(page: Page, selector: string): Promise<{ label: string; px: number }[]> {
  return page.locator(selector).evaluateAll((els) =>
    els.flatMap((box, i) => {
      const cs = getComputedStyle(box);
      if (cs.display === 'inline' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') return [];
      const b = box.getBoundingClientRect();
      if (!b.width || !b.height) return [];
      let worst = 0;
      const measure = (r: DOMRect) => {
        if (!r.width && !r.height) return;
        worst = Math.max(worst, b.left - r.left, r.right - b.right, r.bottom - b.bottom);
      };
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!(node.textContent ?? '').trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of Array.from(range.getClientRects())) measure(r);
      }
      box.querySelectorAll('img, table').forEach((el) => measure(el.getBoundingClientRect()));
      const label = (box.querySelector('h2') ?? box.querySelector('h1, h3, h4, h5, h6'))?.textContent?.trim().slice(0, 25) || `קופסה ${i + 1}`;
      return [{ label, px: Math.round(worst) }];
    }),
  );
}

/**
 * Boxes side by side: no two overlap horizontally, and one horizontal line crosses all of them
 * (so boxes of different heights, aligned at the top, center or bottom, are one row).
 */
export function inOneRow(rects: Rect[]): boolean {
  const byLeft = [...rects].sort((a, b) => a.left - b.left);
  const apart = byLeft.every((r, i) => i === 0 || r.left >= byLeft[i - 1].right - 2);
  return apart && Math.max(...rects.map((r) => r.top)) < Math.min(...rects.map((r) => r.bottom));
}

/** Number of rows the boxes are laid out in: a box that starts below the current row's shortest box starts a new row. */
export function rowCount(rects: Rect[]): number {
  let rows = 0;
  let rowBottom = -Infinity;
  for (const r of [...rects].sort((a, b) => a.top - b.top)) {
    if (r.top < rowBottom) rowBottom = Math.min(rowBottom, r.bottom);
    else {
      rows++;
      rowBottom = r.bottom;
    }
  }
  return rows;
}
