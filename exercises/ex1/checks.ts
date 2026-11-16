import type { Locator, Page } from '@playwright/test';
import { describeColor, isLight, isTransparent, sameColor } from '../../grader/colors';
import {
  atWidth,
  boxOverflow as overflowOf,
  checkBackslashPaths,
  checkDuplicateIds,
  checkImages,
  checkInlineStyles,
  checkLastYear,
  checkMainFileName,
  checkRtl,
  checkSkeleton,
  checkStylesheet,
  grayWithWhiteText,
  inOneRow,
  rowCount,
} from '../../grader/common-checks';
import { rectsOf, stylesOf, summarize, toRgba } from '../../grader/dom';
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
    await checkMainFileName(site, g, C);
    await g.check('קובץ CSS חיצוני מקושר לדף', () => checkStylesheet(site, g, C));
    await checkInlineStyles(page, g, C);
    // Files unrelated to the site: a submission-procedure check for every exercise (grader/protocol.ts).
    await checkBackslashPaths(page, g, C);
  });

  const regions = await tagRegions(page);

  await g.section('מבנה הדף', async () => {
    await g.check('div מרכזי עם המחלקה page', async () => {
      if (!regions.page.found) g.flag(C.NO_PAGE_DIV);
    });
    await checkRtl(page, g, C, regions.page.found ? R('page') : 'body');
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
    await g.check('לא הוגש פתרון משנה שעברה', () => checkLastYear(page, g, C));
    await g.check('הכותרות בדף כנדרש', async () => {
      if (g.has(C.LAST_YEAR)) return; // same cause, already deducted
      const wrong = await requiredTextsDiffer(page);
      if (wrong.length) g.flag(C.REQUIRED_TEXTS, summarize(wrong, 5));
    });
    await checkDuplicateIds(page, g, C);
    await checkSkeleton(page, g, C);
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
      const empty = missing.some((b) => b.h5Empty) ? ' (תגית h5 ריקה)' : '';
      if (missing.length) g.flag(C.BOX_NO_H5, labels(missing) + empty);
    });
    await g.check('רשימה לא ממוספרת עם לפחות שני קישורים', async () => {
      const noList = boxes.filter((b) => !b.ul && !b.ol);
      if (noList.length) g.flag(C.BOX_NO_LIST, labels(noList));
      const ordered = boxes.filter((b) => !b.ul && b.ol);
      if (ordered.length) g.flag(C.BOX_OL, labels(ordered));
      // Two links, each in its own <ul>: a structure mistake, not too few links.
      const split = boxes.filter((b) => (b.ul || b.ol) && b.listLinks < 2 && b.allListLinks >= 2);
      if (split.length) g.flag(C.BOX_SPLIT_LIST, summarize(split.map((b) => `${b.label}: ${b.allListLinks} קישורים ב-${b.lists} רשימות`)));
      const fewLinks = boxes.filter((b) => (b.ul || b.ol) && b.allListLinks < 2);
      if (fewLinks.length) g.flag(C.BOX_FEW_LINKS, summarize(fewLinks.map((b) => `${b.label}: ${b.allListLinks} קישורים`)));
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
      const swapped = tables.filter((t) => t.linksOutsideLinkColumn);
      if (swapped.length) g.flag(C.TABLE_COLUMNS_SWAPPED, labels(swapped));
    });
    await g.check('הקישורים מובילים לדפי מידע', async () => {
      const total = boxes.reduce((n, b) => n + b.links, 0);
      const placeholders = boxes.reduce((n, b) => n + b.placeholderLinks, 0);
      if (placeholders) g.flag(C.LINKS_PLACEHOLDER, `${placeholders} מתוך ${total} קישורים`);
    });
    await g.check('סדר הרכיבים בקופסה', async () => {
      const outOfOrder = boxes.filter((b) => !b.inOrder);
      if (outOfOrder.length) g.flag(C.BOX_ORDER, summarize(outOfOrder.map((b) => `${b.label}: ${b.order.join(' ← ')}`)));
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

  await g.section('תמונות', () => checkImages(site, g, C));

  await g.section('דרישות עיצוב', async () => {
    await g.check('גופן לדף', async () => {
      const s = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.all = 'initial';
        document.body.append(probe);
        const initial = getComputedStyle(probe).fontFamily;
        probe.remove();
        const text = document.querySelector('[data-grader~="box"] p') ?? document.querySelector('p') ?? document.body;
        // A font chosen in the CSS counts even when it is the browser's default (e.g. "Times New Roman").
        const rules: CSSStyleRule[] = [];
        const collect = (list: CSSRuleList) => {
          for (const rule of Array.from(list)) {
            if (rule instanceof CSSStyleRule) rules.push(rule);
            else if (rule instanceof CSSMediaRule && matchMedia(rule.conditionText).matches) collect(rule.cssRules);
          }
        };
        for (const sheet of Array.from(document.styleSheets)) {
          try {
            collect(sheet.cssRules);
          } catch {} // a cross-origin stylesheet can't be read
        }
        const chain: Element[] = [];
        for (let el: Element | null = text; el; el = el.parentElement) chain.push(el);
        const declared = chain.some(
          (el) =>
            (el as HTMLElement).style.fontFamily !== '' ||
            rules.some((rule) => rule.style.fontFamily !== '' && (() => {
              try {
                return el.matches(rule.selectorText);
              } catch {
                return false;
              }
            })()),
        );
        return { font: getComputedStyle(text).fontFamily, initial, declared };
      });
      if (s.font === s.initial && !s.declared) g.flag(C.NO_FONT, `הגופן בדף: ${s.font} (ברירת המחדל של הדפדפן)`);
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
      if (!inOneRow(rects)) {
        const rows = rowCount(rects);
        const floats = await stylesOf(boxes, ['float']);
        const names = await boxLabels(boxes);
        const notFloated = names.filter((_, i) => floats[i]?.float === 'none');
        const why = notFloated.length && notFloated.length < names.length ? ` (קופסאות שאינן צפות: ${summarize(notFloated)})` : '';
        return g.flag(C.NOT_SIDE_BY_SIDE, (rows > 1 ? `הקופסאות מסודרות ב-${rows} שורות` : 'הקופסאות חופפות זו לזו') + why);
      }
      // Only when the layout works: was it done with float? Inside flex/grid, float has no effect.
      const styles = await stylesOf(boxes, ['float', 'display']);
      const [parent] = await stylesOf(boxes.first().locator('xpath=..'), ['display']);
      const flexOrGrid = /flex|grid/.test(parent.display);
      if (flexOrGrid || styles.some((s) => s.float === 'none')) {
        const floated = styles.some((s) => s.float !== 'none');
        g.flag(
          C.NO_FLOAT,
          flexOrGrid ? `display: ${parent.display}${floated ? ' (ה-float שהוגדר לקופסאות אינו משפיע בתוך flex/grid)' : ''}` : `display: ${styles[0].display}`,
        );
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
    await g.check('התוכן נשאר בתוך הקופסאות', async () => {
      if (!regions.boxes.found) return;
      const over = (await boxOverflow(page)).filter((b) => b.px > 4);
      if (over.length) g.flag(C.BOX_OVERFLOW, summarize(over.map((b) => `${b.label}: ${b.px}px`)));
    });
    // Last: it resizes the page. Only when the layout works at full width (otherwise it's already deducted).
    await g.check('הפריסה במסך של מחשב נייד (1366px)', async () => {
      if (regions.boxes.count < 2 || [C.NOT_SIDE_BY_SIDE, C.NOT_CLEARED, C.BOX_OVERFLOW].some((c) => g.has(c))) return;
      const problems = await atWidth(page, 1366, async () => {
        const out: string[] = [];
        const rects = (await rectsOf(page.locator(R('box')))).filter((r) => r.width > 0 && r.height > 0);
        if (!inOneRow(rects)) out.push(`הקופסאות מסודרות ב-${rowCount(rects)} שורות`);
        const over = (await boxOverflow(page)).filter((b) => b.px > 4);
        if (over.length) out.push(`תוכן חורג מהקופסאות: ${summarize(over.map((b) => `${b.label} ${b.px}px`))}`);
        if (regions.popular.found) {
          const [popular] = await rectsOf(page.locator(R('popular')).first());
          if (popular.top < Math.max(...rects.map((r) => r.bottom)) - 2) out.push('אזור השפות הפופולריות עולה על הקופסאות');
        }
        return out;
      });
      if (problems.length) g.flag(C.NARROW_LAYOUT, problems.join('; '));
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
      // Any element, not only div/section: students also use e.g. <span class="card"> as the box.
      const candidates = all('body *').filter((el) => el.querySelector('h2, h3, h4') && el.querySelector('table, ul, ol'));
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

/**
 * The texts the spec asks for, matched loosely (keywords), on the elements that exist.
 * Missing elements are reported by their own checks.
 */
function requiredTextsDiffer(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const norm = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const short = (text: string) => `"${text.length > 30 ? `${text.slice(0, 30)}…` : text}"`;
    const wrong: string[] = [];
    const h1 = document.querySelector('[data-grader~="header"] h1') ?? document.querySelector('h1');
    const title = norm(h1);
    if (h1 && !(title.includes('שפות') && title.includes('אתר'))) wrong.push(`כותרת ראשית: ${short(title)}`);
    const boxes = Array.from(document.querySelectorAll('[data-grader~="box"]'));
    const h5 = boxes.map((b) => norm(b.querySelector('h5'))).find((t) => t && !/לינקים|קישורים/.test(t));
    if (h5) wrong.push(`כותרת h5: ${short(h5)}`);
    const headerRow = boxes
      .map((b) => norm(b.querySelector('table')?.rows[0]))
      .find((t) => t && !(/גי?רס/.test(t) && /לינק|קישור|מידע/.test(t)));
    if (headerRow) wrong.push(`כותרות הטבלה: ${short(headerRow)}`);
    const popular = document.querySelector('[data-grader~="popular"]');
    if (popular) {
      const heading = popular.querySelector('h1, h2, h3, h4, h5, h6');
      const text = norm(heading ?? popular);
      if (!text.includes('פופולר')) wrong.push(`כותרת השפות הפופולריות: ${short(text || '(ריקה)')}`);
    }
    return wrong;
  });
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
          (/גי?רס|לינק|קישור/.test(rows[0]?.textContent ?? '') ||
            (cells.length > 0 && cells.every((c) => parseInt(getComputedStyle(c).fontWeight) >= 600)));
        const headerLike = firstRowTh || !!table.tHead || looksLikeHeader;
        const width = (r: HTMLTableRowElement) => Array.from(r.cells).reduce((n, c) => n + c.colSpan, 0);
        // The column headed "לינק למידע" should hold the links: data rows whose links are all in
        // another column mean the headers don't match the columns.
        const linkHeader = headerLike ? cells.findIndex((c) => /לינק|קישור/.test(c.textContent ?? '') && !/גי?רס/.test(c.textContent ?? '')) : -1;
        const linkRows = rows.slice(headerLike ? 1 : 0).map((r) => Array.from(r.cells).findIndex((c) => !!c.querySelector('a[href]'))).filter((i) => i >= 0);
        tableInfo = {
          firstRowTh,
          headerLike,
          cols: Math.max(0, ...rows.map(width)),
          dataRows: rows.length - (headerLike ? 1 : 0),
          links: table.querySelectorAll('a[href]').length,
          linksOutsideLinkColumn: linkHeader >= 0 && linkRows.length > 0 && linkRows.every((i) => i !== linkHeader),
        };
      }
      // Order of the parts the spec lists (h2, description, h5, list, table), by first appearance.
      const description = Array.from(el.querySelectorAll('p')).find((p) => !p.closest('ul, ol, table'));
      const parts: [string, Element | null | undefined][] = [
        ['h2', el.querySelector('h2')],
        ['p', description],
        ['h5', el.querySelector('h5')],
        ['רשימה', ul ?? ol],
        ['טבלה', table],
      ];
      const present = parts.filter((part): part is [string, Element] => !!part[1]);
      const byPosition = [...present].sort((a, b) => (a[1].compareDocumentPosition(b[1]) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      const anchors = Array.from(el.querySelectorAll('a'));
      // Lists outside the table (a <ul> written inside a <table> is moved out by the browser, empty).
      const lists = Array.from(el.querySelectorAll('ul, ol')).filter((l) => !l.closest('table'));
      const linksIn = (l: Element) => l.querySelectorAll('a[href]').length;
      const placeholder = (a: Element) => /^\s*(#.*)?$|^\s*javascript:/i.test(a.getAttribute('href') ?? '');
      return {
        label: (el.querySelector('h2') ?? heading)?.textContent?.trim().slice(0, 25) || `קופסה ${i + 1}`,
        links: anchors.length,
        placeholderLinks: anchors.filter(placeholder).length,
        inOrder: byPosition.every((part, j) => part === present[j]),
        order: byPosition.map(([name]) => name),
        h2: !!el.querySelector('h2'),
        otherHeading: heading && heading.tagName !== 'H2' ? heading.tagName.toLowerCase() : undefined,
        p: Array.from(el.querySelectorAll('p')).some((p) => (p.textContent ?? '').trim() !== ''),
        h5: Array.from(el.querySelectorAll('h5')).some((h) => (h.textContent ?? '').trim() !== ''),
        h5Empty: !!el.querySelector('h5'),
        ul: !!ul,
        ol: !!ol,
        /** Links in the fullest list, and in all the lists together. */
        listLinks: Math.max(0, ...lists.map(linksIn)),
        allListLinks: lists.reduce((n, l) => n + linksIn(l), 0),
        lists: lists.filter((l) => linksIn(l) > 0).length,
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

/** How far content sticks out of each information box, in px. */
const boxOverflow = (page: Page) => overflowOf(page, R('box'));
