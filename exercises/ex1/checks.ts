import type { Locator, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { describeColor, isGray, isLight, isTransparent, isWhite, sameColor } from '../../grader/colors';
import type { Comment } from '../../grader/comments';
import { rectsOf, stylesOf, summarize, toRgba, type Rect } from '../../grader/dom';
import type { Site } from '../../grader/fixtures';
import type { Grader } from '../../grader/grader';
import { C } from './comments';

/** How a page region was located: by the class the spec asks for, by a fallback, or not at all. */
interface Region {
  found: boolean;
  exact: boolean;
  desc?: string;
}
type Regions = Record<'page' | 'header' | 'languages' | 'popular', Region> & { boxes: Region & { count: number } };

/** Elements located by `tagRegions` carry data-grader="<region>". */
const R = (name: string) => `[data-grader~="${name}"]`;

/**
 * Grades Exercise 1 ("שפות לפיתוח אתרים").
 * Checks look at the rendered result (computed styles, geometry), so any valid technique passes.
 */
export async function gradeEx1(site: Site, g: Grader) {
  const { page } = site;

  await g.section('הגשה וקבצים', async () => {
    await g.check('שם הקובץ הראשי index.html', async () => {
      const name = site.submission.entry!.split('/').pop()!;
      if (name.toLowerCase() !== 'index.html') g.flag(C.MAIN_FILE_NAME, `שם הקובץ: ${name}`);
    });
    await g.check('קובץ CSS חיצוני מקושר לדף', () => checkStylesheet(site, g));
    await g.check('ללא עיצוב inline', async () => {
      const tags = await page
        .locator('[style]')
        .evaluateAll((els) => els.filter((el) => el.getAttribute('style')!.trim() !== '').map((el) => `<${el.tagName.toLowerCase()}>`));
      const detail = `${tags.length} אלמנטים: ${summarize(tags)}`;
      if (tags.length >= 4) g.flag(C.INLINE_MANY, detail);
      else if (tags.length) g.flag(C.INLINE_FEW, detail);
    });
  });

  const regions = await tagRegions(page);

  await g.section('מבנה הדף', async () => {
    await g.check('div מרכזי עם המחלקה page', async () => {
      if (!regions.page.found) g.flag(C.NO_PAGE_DIV);
    });
    await g.check('כיוון מימין לשמאל (rtl)', async () => {
      const [{ direction }] = await stylesOf(page.locator(regions.page.found ? R('page') : 'body').first(), ['direction']);
      if (direction !== 'rtl') g.flag(C.NO_RTL, `direction: ${direction}`);
    });
    await g.check('שמות המחלקות כנדרש', async () => {
      const expected: [string, Region][] = [
        ['page', regions.page],
        ['page-header', regions.header],
        ['languages', regions.languages],
        ['box', regions.boxes],
        ['popular-languages', regions.popular],
      ];
      const different = expected.filter(([, r]) => r.found && !r.exact).map(([cls, r]) => `במקום .${cls}: ${r.desc}`);
      if (!regions.languages.found && regions.boxes.found) different.push('לא נמצא div עם המחלקה languages שעוטף את הקופסאות');
      if (different.length) g.flag(C.CLASS_NAMES, different.join(' | '));
    });
    await g.check('לא הוגש פתרון משנה שעברה', () => checkLastYear(page, g));
    await g.check('id ייחודי לכל אלמנט', async () => {
      const duplicates = await page.locator('[id]').evaluateAll((els) => {
        const counts = new Map<string, number>();
        for (const el of els) if (el.id) counts.set(el.id, (counts.get(el.id) ?? 0) + 1);
        return [...counts].filter(([, n]) => n > 1).map(([id, n]) => `"${id}" ×${n}`);
      });
      if (duplicates.length) g.flag(C.DUPLICATE_ID, summarize(duplicates));
    });
    await g.check('שלד הדף (DOCTYPE, meta charset, title)', async () => {
      const s = await page.evaluate(() => ({
        doctype: document.compatMode === 'CSS1Compat',
        charset: !!document.querySelector('meta[charset], meta[http-equiv="content-type" i]'),
        title: document.title.trim() !== '',
      }));
      const missing = [!s.doctype && '<!DOCTYPE html>', !s.charset && '<meta charset="utf-8">', !s.title && '<title>'].filter(Boolean);
      if (missing.length) g.flag(C.SKELETON, `חסר: ${missing.join(', ')}`);
    });
  });

  await g.section('אזור הכותרת', async () => {
    if (!regions.header.found) return g.check('אזור הכותרת קיים', async () => g.flag(C.NO_HEADER));
    const header = page.locator(R('header')).first();
    await g.check('כותרת ראשית h1', async () => {
      const s = await header.evaluate((el) => ({
        h1: el.tagName === 'H1' || !!el.querySelector('h1'),
        other: el.querySelector('h2, h3, h4, h5, h6')?.tagName.toLowerCase(),
      }));
      if (!s.h1) g.flag(C.NO_H1, s.other ? `נעשה שימוש בתגית ${s.other}` : undefined);
    });
    await g.check('תמונה המייצגת את שלוש השפות', async () => {
      const hasImage = await header.evaluate(
        (el) =>
          !!el.querySelector('img, svg, picture') ||
          [el, ...Array.from(el.querySelectorAll('*'))].some((e) => getComputedStyle(e).backgroundImage.includes('url(')),
      );
      if (!hasImage) g.flag(C.NO_HEADER_IMG);
    });
  });

  await g.section('אזור המידע על השפות', async () => {
    if (!regions.boxes.found) {
      return g.check('קופסאות המידע קיימות', async () => {
        g.flag(C.NO_BOXES);
        g.review('לא נמצאו קופסאות מידע – כדאי לבדוק ידנית');
      });
    }
    const boxes = await analyzeBoxes(page.locator(R('box')));
    const labels = (list: { label: string }[]) => summarize(list.map((b) => b.label));

    await g.check('שלוש קופסאות מידע', async () => {
      if (boxes.length < 3) g.flag(C.FEW_BOXES, `נמצאו ${boxes.length} קופסאות`, { times: 3 - boxes.length });
    });
    await g.check('כותרת h2 בכל קופסה', async () => {
      const missing = boxes.filter((b) => !b.h2);
      if (missing.length) g.flag(C.BOX_NO_H2, summarize(missing.map((b) => b.label + (b.otherHeading ? ` (${b.otherHeading})` : ''))));
    });
    await g.check('פסקה המתארת את השפה', async () => {
      const missing = boxes.filter((b) => !b.p);
      if (missing.length) g.flag(C.BOX_NO_P, labels(missing));
    });
    await g.check('כותרת h5 "לינקים שימושיים"', async () => {
      const missing = boxes.filter((b) => !b.h5);
      if (missing.length) g.flag(C.BOX_NO_H5, labels(missing));
    });
    await g.check('רשימה לא ממוספרת עם לפחות שני קישורים', async () => {
      const noList = boxes.filter((b) => !b.ul && !b.ol);
      if (noList.length) g.flag(C.BOX_NO_LIST, labels(noList));
      const ordered = boxes.filter((b) => !b.ul && b.ol);
      if (ordered.length) g.flag(C.BOX_OL, labels(ordered));
      const fewLinks = boxes.filter((b) => (b.ul || b.ol) && b.listLinks < 2);
      if (fewLinks.length) g.flag(C.BOX_FEW_LINKS, summarize(fewLinks.map((b) => `${b.label}: ${b.listLinks} קישורים`)));
    });
    await g.check('טבלה עם שורת כותרות ושתי שורות מידע', async () => {
      const noTable = boxes.filter((b) => !b.table);
      if (noTable.length) g.flag(C.BOX_NO_TABLE, labels(noTable));
      const tables = boxes.flatMap((b) => (b.table ? [{ label: b.label, ...b.table }] : []));
      const noHeader = tables.filter((t) => !t.headerLike);
      if (noHeader.length) g.flag(C.TABLE_NO_HEADER, labels(noHeader));
      const tdHeader = tables.filter((t) => t.headerLike && !t.firstRowTh);
      if (tdHeader.length) g.flag(C.TABLE_TD_HEADER, labels(tdHeader));
      const shape = tables.filter((t) => t.cols !== 2 || t.dataRows < 2);
      if (shape.length) g.flag(C.TABLE_SHAPE, summarize(shape.map((t) => `${t.label}: ${t.cols} עמודות, ${t.dataRows} שורות מידע`)));
      const noLinks = tables.filter((t) => t.links === 0);
      if (noLinks.length) g.flag(C.TABLE_NO_LINKS, labels(noLinks));
    });
  });

  await g.section('אזור שפות פופולריות', async () => {
    if (!regions.popular.found) return g.check('אזור השפות הפופולריות קיים', async () => g.flag(C.NO_POPULAR));
    const s = await page
      .locator(R('popular'))
      .first()
      .evaluate((el) => ({
        heading: el.matches('h1, h2, h3, h4, h5, h6') || !!el.querySelector('h1, h2, h3, h4, h5, h6'),
        text: (el.textContent ?? '').trim() !== '',
        images: el.querySelectorAll('img').length,
      }));
    await g.check('כותרת', async () => {
      if (!s.heading) g.flag(C.POPULAR_NO_TITLE, s.text ? 'הטקסט אינו בתגית כותרת (h1–h6)' : undefined);
    });
    await g.check('שש תמונות של שפות', async () => {
      if (s.images < 6) g.flag(C.POPULAR_FEW_IMGS, `נמצאו ${s.images} תמונות`, { times: 6 - s.images });
    });
  });

  await g.section('תמונות', async () => {
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
      if (outside.length) g.flag(C.NO_IMAGES_FOLDER, summarize(outside.map((i) => i.src)));
    });
    await g.check('אותיות גדולות/קטנות בנתיבים', async () => {
      // Show paths as the student wrote them: relative to the page's folder.
      const pageDir = site.submission.entry!.split('/').slice(0, -1).join('/');
      const relative = (p: string) => (pageDir && p.startsWith(`${pageDir}/`) ? p.slice(pageDir.length + 1) : p);
      const mismatches = site.caseMismatches.map((m) => `כתוב "${relative(m.requested)}" אך שם הקובץ "${relative(m.actual)}"`);
      if (mismatches.length) g.flag(C.PATH_CASE, summarize(mismatches, 3));
    });
  });

  await g.section('דרישות עיצוב', async () => {
    await g.check('גופן לדף', async () => {
      const s = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.all = 'initial';
        document.body.append(probe);
        const initial = getComputedStyle(probe).fontFamily;
        probe.remove();
        const text = document.querySelector('[data-grader~="box"] p') ?? document.querySelector('p') ?? document.body;
        return { font: getComputedStyle(text).fontFamily, initial };
      });
      if (s.font === s.initial) g.flag(C.NO_FONT, `הגופן בדף: ${s.font} (ברירת המחדל של הדפדפן)`);
    });
    await g.check('צבע רקע בהיר לדף', async () => {
      const targets = ['html', 'body', ...(regions.page.found ? [R('page')] : [])];
      const styles = await Promise.all(
        targets.map(async (sel) => (await stylesOf(page.locator(sel).first(), ['background-color', 'background-image']))[0]),
      );
      const colors = (await toRgba(page, styles.map((s) => s['background-color']))).filter((c) => !isTransparent(c));
      const image = styles.some((s) => s['background-image'] !== 'none');
      if (!image && !colors.some(isLight)) {
        g.flag(C.NO_LIGHT_BG, colors.length ? `צבע הרקע: ${summarize(colors.map(describeColor))}` : 'לא הוגדר צבע רקע');
      }
    });
    await g.check('אזור הכותרת: רקע אפור וטקסט לבן', async () => {
      if (regions.header.found) await grayWithWhiteText(page, R('header'), C.HEADER_NOT_GRAY, C.HEADER_NOT_WHITE, g);
    });
    await g.check('אזור השפות הפופולריות: רקע אפור וטקסט לבן', async () => {
      if (regions.popular.found) await grayWithWhiteText(page, R('popular'), C.POPULAR_NOT_GRAY, C.POPULAR_NOT_WHITE, g);
    });
    await g.check('שלוש הקופסאות זו לצד זו באמצעות float', async () => {
      if (regions.boxes.count < 2) return;
      const boxes = page.locator(R('box'));
      const rects = (await rectsOf(boxes)).filter((r) => r.width > 0 && r.height > 0);
      const byLeft = [...rects].sort((a, b) => a.left - b.left);
      const sideBySide = byLeft.every(
        (r, i) => i === 0 || (r.left >= byLeft[i - 1].right - 2 && Math.abs(r.top - byLeft[0].top) <= 20),
      );
      if (!sideBySide) {
        const rows = rowCount(rects);
        return g.flag(C.NOT_SIDE_BY_SIDE, rows > 1 ? `הקופסאות מסודרות ב-${rows} שורות` : 'הקופסאות חופפות זו לזו');
      }
      // Only when the layout works: was it done with float?
      const styles = await stylesOf(boxes, ['float', 'display']);
      if (styles.some((s) => s.float === 'none')) {
        const [parent] = await stylesOf(boxes.first().locator('xpath=..'), ['display']);
        g.flag(C.NO_FLOAT, `display: ${/flex|grid/.test(parent.display) ? parent.display : styles[0].display}`);
      }
    });
    await g.check('רקע בהיר, ריפוד, מסגרת מעוגלת וצל לקופסאות', async () => {
      if (!regions.boxes.found) return;
      const boxes = page.locator(R('box'));
      const names = await boxLabels(boxes);
      const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((c) => `border-${c}-radius`);
      const sides = ['top', 'right', 'bottom', 'left'].map((s) => `padding-${s}`);
      const styles = await stylesOf(boxes, ['background-color', 'background-image', 'box-shadow', 'filter', ...sides, ...corners]);
      const backgrounds = await toRgba(page, styles.map((s) => s['background-color']));
      const anyPositive = (s: Record<string, string>, props: string[]) => props.some((p) => parseFloat(s[p]) > 0);
      const failing = (test: (s: Record<string, string>, i: number) => boolean) =>
        styles.flatMap((s, i) => (test(s, i) ? [i] : []));

      const noBackground = failing((s, i) => !isLight(backgrounds[i]) && s['background-image'] === 'none');
      if (noBackground.length) {
        g.flag(C.BOX_NO_BG, summarize(noBackground.map((i) => `${names[i]}: ${describeColor(backgrounds[i])}`)));
      }
      const noPadding = failing((s) => !anyPositive(s, sides));
      if (noPadding.length) g.flag(C.BOX_NO_PADDING, summarize(noPadding.map((i) => names[i])));
      const noRadius = failing((s) => !anyPositive(s, corners));
      if (noRadius.length) g.flag(C.BOX_NO_RADIUS, summarize(noRadius.map((i) => names[i])));
      const noShadow = failing((s) => s['box-shadow'] === 'none' && !s.filter.includes('drop-shadow'));
      if (noShadow.length) g.flag(C.BOX_NO_SHADOW, summarize(noShadow.map((i) => names[i])));
    });
    await g.check('כותרות השפות בצבעים שונים', async () => {
      const colors = await page.locator(R('box')).evaluateAll((els) =>
        els.flatMap((el) => {
          const heading = el.querySelector('h2') ?? el.querySelector('h1, h3, h4, h5, h6');
          return heading ? [getComputedStyle(heading).color] : [];
        }),
      );
      if (colors.length < 2) return;
      const rgba = await toRgba(page, colors);
      const distinct = rgba.filter((c, i) => rgba.findIndex((other) => sameColor(other, c)) === i);
      if (distinct.length < rgba.length) g.flag(C.TITLES_SAME_COLOR, rgba.map(describeColor).join(', '));
    });
    await g.check('אזור השפות הפופולריות מתחת לקופסאות הצפות', async () => {
      if (!regions.popular.found || !regions.boxes.found) return;
      const [popular] = await rectsOf(page.locator(R('popular')).first());
      const bottom = Math.max(...(await rectsOf(page.locator(R('box')))).map((r) => r.bottom));
      if (popular.top < bottom - 2) {
        g.flag(C.NOT_CLEARED, `האזור מתחיל ${Math.round(bottom - popular.top)}px מעל תחתית הקופסאות`);
      }
    });
  });
}

/**
 * Finds the regions the spec asks for and tags them with data-grader="<region>".
 * When a class is missing, a likely equivalent is used instead (reported as a 0-point note).
 */
function tagRegions(page: Page): Promise<Regions> {
  return page.evaluate(() => {
    const all = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel));
    const pick = (sels: string[], ok: (el: HTMLElement) => boolean) => {
      for (const sel of sels) for (const el of all(sel)) if (ok(el)) return el;
      return null;
    };
    const isRoot = (el: Element | null) => !el || el === document.body || el === document.documentElement;
    const depth = (el: Element) => {
      let d = 0;
      for (let p = el.parentElement; p; p = p.parentElement) d++;
      return d;
    };
    const describe = (el: Element | null) =>
      el ? el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + Array.from(el.classList, (c) => `.${c}`).join('') : undefined;
    const region = (el: Element | null, exact: boolean) => ({ found: !!el, exact: !!el && exact, desc: describe(el) });

    // Boxes: by class, or the innermost blocks holding a heading plus a table or list.
    let boxes = all('.box');
    const boxesExact = boxes.length > 0;
    if (!boxesExact) {
      const candidates = all('div, section, article, aside').filter((el) => el.querySelector('h2, h3, h4') && el.querySelector('table, ul, ol'));
      boxes = candidates.filter((el) => !candidates.some((other) => other !== el && el.contains(other)));
    }
    const touchesBox = (el: Element) => boxes.some((b) => b.contains(el) || el.contains(b));

    // Languages: by class, or the closest element holding all the boxes.
    let languages = document.querySelector<HTMLElement>('.languages');
    const languagesExact = !!languages;
    if (!languages && boxes.length) {
      let anc: HTMLElement | null = boxes[0].parentElement;
      while (anc && !boxes.every((b) => anc!.contains(b))) anc = anc.parentElement;
      languages = isRoot(anc) || anc!.classList.contains('page') ? null : anc;
    }

    // Header: by class, by a header-like name, or around the h1.
    let header = document.querySelector<HTMLElement>('.page-header');
    const headerExact = !!header;
    if (!header) {
      header = pick(['header', '.header', '#header', '[class*="header" i]', '[id*="header" i]'], (el) => !isRoot(el) && !touchesBox(el));
    }
    if (!header) {
      const h1 = document.querySelector<HTMLElement>('h1');
      const parent = h1?.parentElement ?? null;
      if (h1) {
        const parentIsHeader = !isRoot(parent) && !parent!.classList.contains('page') && !touchesBox(parent!) && !parent!.querySelector('table, ul, ol');
        header = parentIsHeader ? parent : h1;
      }
    }

    // Popular languages: by class, by a popular/footer-like name, or the block with the most images.
    let popular = document.querySelector<HTMLElement>('.popular-languages');
    const popularExact = !!popular;
    const awayFromHeader = (el: Element) => !header || !(header.contains(el) || el.contains(header));
    if (!popular) {
      popular = pick(
        ['footer', '.footer', '#footer', '[class*="popular" i]', '[id*="popular" i]', '[class*="footer" i]'],
        (el) => !isRoot(el) && !touchesBox(el) && awayFromHeader(el),
      );
    }
    if (!popular) {
      const candidates = all('div, section, footer, aside, ul').filter(
        (el) => el.querySelectorAll('img').length >= 3 && !touchesBox(el) && awayFromHeader(el),
      );
      candidates.sort((a, b) => b.querySelectorAll('img').length - a.querySelectorAll('img').length || depth(a) - depth(b));
      popular = candidates[0] ?? null;
    }

    // Page wrapper: by class, or a top-level block that wraps all the regions.
    let pageEl = document.querySelector<HTMLElement>('.page');
    const pageExact = !!pageEl;
    if (!pageEl) {
      const parts = [header, languages ?? boxes[0], popular].filter((el): el is HTMLElement => !!el);
      pageEl = all('body > div, body > main, body > section, body > article').find(
        (w) => parts.length > 1 && parts.every((p) => p !== w && w.contains(p)),
      ) ?? null;
    }

    const tag = (el: Element | null, name: string) =>
      el?.setAttribute('data-grader', `${el.getAttribute('data-grader') ?? ''} ${name}`.trim());
    tag(pageEl, 'page');
    tag(header, 'header');
    tag(languages, 'languages');
    boxes.forEach((b) => tag(b, 'box'));
    tag(popular, 'popular');

    return {
      page: region(pageEl, pageExact),
      header: region(header, headerExact),
      languages: region(languages, languagesExact),
      boxes: { ...region(boxes[0] ?? null, boxesExact), count: boxes.length },
      popular: region(popular, popularExact),
    };
  });
}

async function checkStylesheet(site: Site, g: Grader) {
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
  const own = links.filter((l) => l.href.startsWith(origin) || !/^https?:/i.test(l.href));
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
    (f) => /\.css$/i.test(f) && fs.readFileSync(path.join(site.submission.rootDir!, f), 'utf8').trim() !== '',
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

/** Last year's version used header/container/footer divs and a different h1. */
async function checkLastYear(page: Page, g: Grader) {
  const s = await page.evaluate(() => ({
    h1: document.querySelector('h1')?.textContent ?? '',
    h2: Array.from(document.querySelectorAll('h2'), (h) => h.textContent ?? '').join(' '),
    oldClasses: ['width-full', 'footer-images'].filter((c) => document.querySelector(`.${c}`)),
    containerAndFooter: !!document.querySelector('.container') && !!document.querySelector('.footer'),
    newClasses: ['page-header', 'popular-languages'].some((c) => document.querySelector(`.${c}`)),
  }));
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

function analyzeBoxes(boxes: Locator) {
  return boxes.evaluateAll((els) =>
    els.map((el, i) => {
      const heading = el.querySelector('h1, h2, h3, h4, h5, h6');
      const ul = el.querySelector('ul');
      const ol = el.querySelector('ol');
      const table = el.querySelector('table');
      let tableInfo = null;
      if (table) {
        const rows = Array.from(table.rows);
        const cells = rows[0] ? Array.from(rows[0].cells) : [];
        const firstRowTh = cells.length > 0 && cells.every((c) => c.tagName === 'TH');
        // A header row written with td: no links, and header-like text or bold cells.
        const looksLikeHeader =
          !rows[0]?.querySelector('a') &&
          (/גרס|לינק|קישור/.test(rows[0]?.textContent ?? '') ||
            (cells.length > 0 && cells.every((c) => parseInt(getComputedStyle(c).fontWeight) >= 600)));
        const headerLike = firstRowTh || !!table.tHead || looksLikeHeader;
        const width = (r: HTMLTableRowElement) => Array.from(r.cells).reduce((n, c) => n + c.colSpan, 0);
        tableInfo = {
          firstRowTh,
          headerLike,
          cols: Math.max(0, ...rows.map(width)),
          dataRows: rows.length - (headerLike ? 1 : 0),
          links: table.querySelectorAll('a[href]').length,
        };
      }
      return {
        label: (el.querySelector('h2') ?? heading)?.textContent?.trim().slice(0, 25) || `קופסה ${i + 1}`,
        h2: !!el.querySelector('h2'),
        otherHeading: heading && heading.tagName !== 'H2' ? heading.tagName.toLowerCase() : undefined,
        p: Array.from(el.querySelectorAll('p')).some((p) => (p.textContent ?? '').trim() !== ''),
        h5: !!el.querySelector('h5'),
        ul: !!ul,
        ol: !!ol,
        listLinks: (ul ?? ol)?.querySelectorAll('a[href]').length ?? 0,
        table: tableInfo,
      };
    }),
  );
}

function boxLabels(boxes: Locator): Promise<string[]> {
  return boxes.evaluateAll((els) =>
    els.map((el, i) => (el.querySelector('h2') ?? el.querySelector('h1, h3, h4, h5, h6'))?.textContent?.trim().slice(0, 25) || `קופסה ${i + 1}`),
  );
}

/** Gray background on the region (or its heading) and white text in its heading. */
async function grayWithWhiteText(page: Page, region: string, notGray: Comment, notWhite: Comment, g: Grader) {
  const s = await page
    .locator(region)
    .first()
    .evaluate((el) => {
      const heading = el.matches('h1, h2, h3, h4, h5, h6') ? el : el.querySelector('h1, h2, h3, h4, h5, h6');
      return {
        background: getComputedStyle(el).backgroundColor,
        headingBackground: heading ? getComputedStyle(heading).backgroundColor : 'transparent',
        text: getComputedStyle(heading ?? el).color,
      };
    });
  const [background, headingBackground, text] = await toRgba(page, [s.background, s.headingBackground, s.text]);
  if (!isGray(background) && !isGray(headingBackground)) {
    g.flag(notGray, `צבע הרקע: ${describeColor(isTransparent(background) ? headingBackground : background)}`);
  }
  if (!isWhite(text)) g.flag(notWhite, `צבע הטקסט: ${describeColor(text)}`);
}

/** Number of rows the boxes are laid out in (tops more than 20px apart start a new row). */
function rowCount(rects: Rect[]): number {
  const tops = rects.map((r) => r.top).sort((a, b) => a - b);
  return tops.filter((top, i) => i === 0 || top - tops[i - 1] > 20).length;
}
