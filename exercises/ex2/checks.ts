import { test, type Page } from '@playwright/test';
import { BOOTSTRAP_VERSION, bootstrapClasses, bootstrapState, injectBootstrap, type BootstrapState } from '../../grader/bootstrap';
import { describeColor, sameColor } from '../../grader/colors';
import {
  boxOverflow,
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
} from '../../grader/common-checks';
import { summarize, toRgba, type Rect } from '../../grader/dom';
import type { Site } from '../../grader/fixtures';
import type { Grader } from '../../grader/grader';
import { C } from './comments';

/** Elements located by `tagRegions` carry data-grader="<region>". */
const R = (name: string) => `[data-grader~="${name}"]`;

/**
 * The screen widths the page is measured at, one inside each Bootstrap range the exercise uses,
 * with what the spec asks for there: cards per row and whether the versions area shows.
 */
const WIDTHS = [
  { name: 'xs', width: 400, perRow: 1, versions: false },
  { name: 'sm', width: 650, perRow: 2, versions: false },
  { name: 'md', width: 850, perRow: 2, versions: true },
  { name: 'lg', width: 1100, perRow: 3, versions: true },
  { name: 'xxl', width: 1920, perRow: 3, versions: true },
] as const;
type WidthName = (typeof WIDTHS)[number]['name'];

const COL_CLASS = /^col(-(sm|md|lg|xl|xxl))?(-(\d+|auto))?$/;
/** The classes listed in the exercise's table ("מחלקות Bootstrap לשימוש בתרגיל"). */
const SPEC_CLASSES = [
  'container-fluid', 'row', 'col-12', 'col-sm-6', 'col-lg-4', 'col-6', 'col-2', 'card', 'card-body',
  'h-100', 'img-fluid', 'd-none', 'd-md-block', 'g-0', 'gy-4', 'border', 'p-2',
];
/** Class-name prefixes that look like Bootstrap's, for spotting names that don't exist in it (col-xs-12). */
const BOOTSTRAP_LIKE = /^(col|row|container|d|g|gx|gy|[mp][xytbse]?|card|img|h|w|border|text|bg|offset|order|justify-content|align-items|no-gutters)(-|$)/;

/**
 * Grades Exercise 2 ("התאמת הדף באמצעות Bootstrap").
 * The page is measured at five widths (xs, sm, md, lg, xxl) and the layout at each is compared
 * with the spec, so any working technique passes the layout checks; using Bootstrap's classes
 * for it is graded separately at the end (the exercise is about Bootstrap).
 */
export async function gradeEx2(site: Site, g: Grader) {
  const { page } = site;

  // Bootstrap first: when its link is broken the page is graded with it added (like a broken style.css link).
  let bootstrap: BootstrapState | undefined;
  await g.section('הגדרת Bootstrap', async () => {
    await g.check('Bootstrap מקושר ונטען', async () => {
      bootstrap = await bootstrapState(page);
      await checkBootstrapLoaded(site, g, bootstrap);
    });
    await g.check('קובץ ה-RTL של Bootstrap', async () => {
      const loaded = bootstrap?.links.filter((l) => l.loaded) ?? [];
      if (loaded.length && !loaded.some((l) => l.rtl)) g.flag(C.BOOTSTRAP_NOT_RTL, `href="${loaded[0].attr}"`);
    });
    await g.check('style.css מקושר אחרי Bootstrap', async () => {
      if (bootstrap?.ownBefore.length) g.flag(C.BOOTSTRAP_AFTER_STYLE, `לפני Bootstrap: ${summarize(bootstrap.ownBefore)}`);
    });
    await g.check('תגית viewport', async () => {
      const content = await page.evaluate(() => document.querySelector('meta[name="viewport" i]')?.getAttribute('content') ?? null);
      if (content === null) g.flag(C.NO_VIEWPORT);
      else if (!/width\s*=\s*device-width/i.test(content)) g.flag(C.NO_VIEWPORT, `content="${content}"`);
    });
    await g.check('lang="he" בתגית html', async () => {
      const lang = await page.evaluate(() => document.documentElement.getAttribute('lang') ?? '');
      if (!/^(he|iw)\b/i.test(lang.trim())) g.flag(C.NO_LANG, lang ? `lang="${lang}"` : undefined);
    });
    await g.check('שמות המחלקות כתובים נכון', () => checkClassSyntax(page, g));
  });

  await g.section('הגשה וקבצים', async () => {
    await checkMainFileName(site, g, C);
    // A downloaded copy of Bootstrap in the zip isn't the student's own stylesheet.
    await g.check('קובץ CSS חיצוני מקושר לדף', () => checkStylesheet(site, g, C, { ignore: (f) => /bootstrap/i.test(f) }));
    await checkInlineStyles(page, g, C);
    await checkBackslashPaths(page, g, C);
  });

  const regions = await tagRegions(page);

  // Everything layout-related is measured once per width; the checks below only read these snapshots.
  let snaps: Partial<Record<WidthName, Snapshot>> = {};
  await g.check('מדידת הדף ברוחבי מסך שונים', async () => {
    snaps = await measureWidths(page);
  });
  const at = (name: WidthName) => snaps[name];
  const measured = WIDTHS.every((w) => snaps[w.name]);

  await g.section('מבנה הדף', async () => {
    await checkRtl(page, g, C, regions.page.found ? R('page') : 'body');
    await g.check('שמות המחלקות כנדרש', async () => {
      const different = (
        [
          ['page', regions.page],
          ['page-header', regions.header],
          ['languages', regions.languages],
          ['box', regions.cards],
          ['popular-languages', regions.popular],
        ] as const
      )
        .filter(([, r]) => r.found && !r.exact)
        .map(([cls, r]) => `במקום .${cls}: ${r.desc}`);
      if (different.length) g.flag(C.CLASS_NAMES, different.join(' | '));
    });
    await g.check('לא הוגש פתרון משנה שעברה', () => checkLastYear(page, g, C, ['list-group-item', 'lh-lg']));
    await g.check('הכותרות בדף כנדרש', async () => {
      if (g.has(C.LAST_YEAR)) return; // same cause, already deducted
      const wrong = await requiredTextsDiffer(page);
      if (wrong.length) g.flag(C.REQUIRED_TEXTS, summarize(wrong, 5));
    });
    await checkDuplicateIds(page, g, C);
    await checkSkeleton(page, g, C);
    await g.check('המעטפת מתפרסת על כל רוחב המסך (container-fluid)', async () => {
      const s = at('xxl');
      // With container-fluid, a narrower page is the max-width kept from exercise 1's design.
      if (!regions.page.found || !s?.page || s.pageFluid) return;
      if (s.page.width < 0.95 * s.width) {
        g.flag(C.PAGE_NOT_FLUID, `ברוחב ${s.width}px המעטפת ברוחב ${Math.round(s.page.width)}px (${regions.page.desc})`);
      }
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
    await g.check('תמונת הכותרת', async () => {
      if (!regions.headerImage) g.flag(C.NO_HEADER_IMG);
    });
    await g.check('תמונת הכותרת אינה רחבה מהמסך (img-fluid)', async () => {
      const s = at('xs');
      if (!s?.header || !s.headerImg) return;
      const over = Math.max(s.headerImg.right - s.header.right, s.header.left - s.headerImg.left);
      if (over > 1) g.flag(C.HEADER_IMG_OVERFLOW, `ברוחב ${s.width}px התמונה ברוחב ${Math.round(s.headerImg.width)}px ואזור הכותרת ${Math.round(s.header.width)}px`);
    });
    await g.check('רקע אפור וטקסט לבן', () => grayWithWhiteText(page, R('header'), C.HEADER_NOT_GRAY, C.HEADER_NOT_WHITE, g));
  });

  await g.section('כרטיסי השפות', async () => {
    if (!regions.cards.count) return g.check('כרטיסי המידע קיימים', async () => g.flag(C.NO_CARDS));
    await g.check('שלושה כרטיסים', async () => {
      const n = regions.cards.count;
      if (n < 3) g.flag(C.FEW_CARDS, `נמצאו ${n} כרטיסים`, { times: 3 - n });
    });
    await g.check('התוכן של כל כרטיס', async () => {
      const missing = regions.cardInfo.filter((c) => c.missing.length || !c.versions);
      // A card without its versions area, while others have it (all of them missing it is its own comment).
      const versionsElsewhere = regions.cardInfo.some((c) => c.versions);
      const parts = missing.flatMap((c) => {
        const what = [...c.missing, ...(!c.versions && versionsElsewhere ? ['אזור הגרסאות'] : [])];
        return what.length ? [`${c.label}: ${what.join(', ')}`] : [];
      });
      if (parts.length) g.flag(C.CARD_CONTENT, summarize(parts));
    });
    await g.check('כרטיס של Bootstrap (card)', async () => {
      const plain = regions.cardInfo.filter((c) => !c.bootstrapCard);
      if (plain.length) g.flag(C.NO_CARD, summarize(plain.map((c) => `${c.label}: ${c.desc}`)));
    });
    await g.check('הכרטיס ממלא את העמודה (ללא float/רוחב מתרגיל 1)', async () => {
      const s = at('xxl');
      if (!s) return;
      const narrow = s.cards.filter((c) => c.colInner && c.rect.width > 0 && c.rect.width < 0.9 * c.colInner.width);
      if (narrow.length) {
        g.flag(
          C.BOX_OLD_LAYOUT,
          summarize(narrow.map((c) => `${c.label}: ${Math.round((100 * c.rect.width) / c.colInner!.width)}% מרוחב העמודה${c.float !== 'none' ? `, float: ${c.float}` : ''}`)),
        );
      }
    });
    await g.check('הגדרות float / clear שנשארו מתרגיל 1', async () => {
      // Without Bootstrap's grid the floats are still the layout (graded as NO_BOOTSTRAP).
      if (g.has(C.BOX_OLD_LAYOUT) || !bootstrap?.gridElements) return;
      const leftovers = await floatLeftovers(page);
      if (leftovers.length) g.flag(C.OLD_FLOAT_CSS, summarize(leftovers));
    });
    await g.check('כרטיסים באותה שורה באותו גובה (h-100)', async () => {
      if (g.has(C.BOX_OLD_LAYOUT)) return;
      const uneven = (['md', 'xxl'] as const).flatMap((name) => {
        const s = at(name);
        if (!s) return [];
        return lines(s.cards.map((c) => c.colRect))
          .filter((line) => line.length > 1)
          .flatMap((line) => {
            const heights = line.map((i) => s.cards[i].rect.height);
            return Math.max(...heights) - Math.min(...heights) > 2 ? [`ברוחב ${s.width}px: ${heights.map((h) => `${Math.round(h)}px`).join(' / ')}`] : [];
          });
      });
      if (uneven.length) g.flag(C.CARD_UNEQUAL_HEIGHT, summarize(uneven));
    });
    await g.check('רווח אנכי בין כרטיסים (gy-4)', async () => {
      const s = at('xs');
      if (!s || s.cards.length < 2) return;
      const rects = s.cards.map((c) => c.rect).sort((a, b) => a.top - b.top);
      const stacked = rects.every((r, i) => i === 0 || r.top >= rects[i - 1].bottom - 2);
      if (!stacked) return; // reported by the layout checks
      const gaps = rects.slice(1).map((r, i) => r.top - rects[i].bottom);
      if (Math.min(...gaps) < 8) g.flag(C.CARDS_NO_GAP, `ברוחב ${s.width}px הרווח בין הכרטיסים ${Math.round(Math.min(...gaps))}px`);
    });
    await g.check('צל לכרטיסים', async () => {
      const s = at('xxl');
      const flat = s?.cards.filter((c) => !c.shadow) ?? [];
      if (flat.length) g.flag(C.CARD_NO_SHADOW, summarize(flat.map((c) => c.label)));
    });
    await g.check('כותרות השפות בצבעים שונים', async () => {
      const colors = await page.locator(R('card')).evaluateAll((els) =>
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
    await g.check('התוכן נשאר בתוך הכרטיסים', async () => {
      if (g.has(C.BOX_OLD_LAYOUT)) return;
      const over = WIDTHS.flatMap((w) => (snaps[w.name]?.overflowing ?? []).map((b) => `${b.label} ב-${w.width}px: ${b.px}px`));
      if (over.length) g.flag(C.BOX_OVERFLOW, summarize(over, 3));
    });
    await g.check('הקישורים מובילים לדפי מידע', async () => {
      const s = await page.locator(R('card')).evaluateAll((els) => {
        const anchors = els.flatMap((el) => Array.from(el.querySelectorAll('a')));
        const placeholder = anchors.filter((a) => /^\s*(#.*)?$|^\s*javascript:/i.test(a.getAttribute('href') ?? ''));
        return { total: anchors.length, placeholder: placeholder.length };
      });
      if (s.placeholder) g.flag(C.LINKS_PLACEHOLDER, `${s.placeholder} מתוך ${s.total} קישורים`);
    });
  });

  await g.section('פריסה רספונסיבית של הכרטיסים', async () => {
    if (regions.cards.count < 2 || !measured) return;
    await g.check('מספר הכרטיסים בשורה בכל גודל מסך', async () => checkCardsGrid(snaps as Record<WidthName, Snapshot>, g));
  });

  await g.section('אזור הגרסאות', async () => {
    if (!regions.cards.count) return;
    const withVersions = regions.cardInfo.filter((c) => c.versions);
    if (!withVersions.length) return g.check('אזור הגרסאות קיים', async () => g.flag(C.VERSIONS_MISSING));
    await g.check('הטבלה הוחלפה ב-div-ים', async () => {
      const tables = withVersions.filter((c) => c.versions!.table);
      if (tables.length) g.flag(C.VERSIONS_TABLE_KEPT, summarize(tables.map((c) => c.label)));
    });
    if (!measured) return;
    await g.check('מוסתר במסכים קטנים ומוצג החל מ-md', async () => checkVersionsVisibility(snaps as Record<WidthName, Snapshot>, regions, g));
    await g.check('שלוש שורות ובכל אחת שני תאים', async () => checkVersionsGrid(snaps as Record<WidthName, Snapshot>, g));
  });

  await g.section('אזור שפות פופולריות', async () => {
    if (!regions.popular.found) return g.check('אזור השפות הפופולריות קיים', async () => g.flag(C.NO_POPULAR));
    await g.check('כותרת', async () => {
      if (!regions.popularInfo.heading) g.flag(C.POPULAR_NO_TITLE, regions.popularInfo.text ? 'הטקסט אינו בתגית כותרת (h1–h6)' : undefined);
    });
    await g.check('שש תמונות של שפות', async () => {
      const n = regions.popularInfo.images;
      if (n < 6) g.flag(C.POPULAR_FEW_IMGS, `נמצאו ${n} תמונות`, { times: 6 - n });
    });
    if (measured && regions.popularInfo.images >= 2) {
      await g.check('התמונות בשורה אחת ומתחלקות שווה בכל גודל מסך', async () => checkPopularRow(snaps as Record<WidthName, Snapshot>, g));
      await g.check('התמונות אינן רחבות מהעמודות (img-fluid)', async () => {
        const s = at('xs')!;
        const over = s.popularImgs.flatMap((img) =>
          !img.isCol && img.rect.width > img.room + 1 ? [`${Math.round(img.rect.width)}px בעמודה של ${Math.round(img.room)}px`] : [],
        );
        if (over.length) g.flag(C.POPULAR_IMG_OVERFLOW, `ברוחב ${s.width}px: ${summarize(over, 2)}`);
      });
    }
    await g.check('רקע אפור וטקסט לבן', () => grayWithWhiteText(page, R('popular'), C.POPULAR_NOT_GRAY, C.POPULAR_NOT_WHITE, g));
  });

  await g.section('תמונות', () => checkImages(site, g, C));

  await g.section('גלילה אופקית', async () => {
    if (!measured) return;
    await g.check('הדף אינו רחב מהמסך', async () => {
      // Images wider than their area are reported on their own; this is for anything else.
      const wide = WIDTHS.flatMap((w) => {
        const s = snaps[w.name]!;
        const others = s.overflowers.filter((o) => o.cause === 'other');
        return s.overflow > 1 && others.length ? [`ברוחב ${s.width}px הדף רחב ב-${Math.round(s.overflow)}px מהמסך (${summarize(others.map((o) => o.desc), 2)})`] : [];
      });
      if (wide.length) g.flag(C.HORIZONTAL_SCROLL, summarize(wide, 2));
    });
  });

  // Last: whether the layout that works was made with Bootstrap's classes.
  await g.section('שימוש במחלקות Bootstrap', async () => {
    await g.check('הפריסה נבנתה במחלקות Bootstrap', async () => {
      if (!bootstrap) return;
      if (bootstrap.gridElements === 0) {
        const linked = bootstrap.links.length > 0;
        g.flag(C.NO_BOOTSTRAP, linked ? 'הספרייה קושרה, אך לא נעשה שימוש במחלקות row / col-*' : 'הספרייה לא קושרה ולא נעשה שימוש במחלקות שלה');
        g.review('לא נעשה שימוש ב-Bootstrap – כדאי לבדוק ידנית');
        return;
      }
      if (!measured) return;
      const areas = ownCssAreas(regions, snaps as Record<WidthName, Snapshot>, g);
      if (areas.length) g.flag(C.OWN_CSS_LAYOUT, areas.join(', '));
    });
    await g.check('שמות מחלקות שאינם קיימים ב-Bootstrap', () => checkUnknownClasses(page, g));
    await g.check('מחלקות Bootstrap מטבלת התרגיל', async () => {
      if (g.has(C.NO_BOOTSTRAP)) return;
      const missing = await page.evaluate((classes) => classes.filter((c) => !document.querySelector(`.${c}`)), SPEC_CLASSES);
      // A missing class whose effect is already deducted (or explained by another comment) isn't repeated here.
      const explained = (cls: string) => (CLASS_COMMENTS[cls] ?? []).some((key) => g.has(C[key]));
      const unexplained = missing.filter((c) => !explained(c));
      if (unexplained.length) g.flag(C.BOOTSTRAP_CLASSES, `חסרות: ${unexplained.join(', ')}`);
    });
  });
}

type CommentKey = keyof typeof C;
const CARD_GRID: CommentKey[] = ['CARDS_XS', 'CARDS_SM', 'CARDS_SM_FROM_MD', 'CARDS_SM_LAST', 'CARDS_MD', 'CARDS_LG', 'CARDS_LG_FROM_XL', 'OWN_CSS_LAYOUT'];
const VERSIONS_HIDE: CommentKey[] = ['VERSIONS_NOT_HIDDEN', 'VERSIONS_HIDE_BROKEN', 'VERSIONS_HIDE_ONE_SIZE', 'VERSIONS_HIDDEN_AT_MD', 'VERSIONS_ALWAYS_HIDDEN', 'OWN_CSS_LAYOUT', 'VERSIONS_MISSING'];
const VERSIONS_GRID: CommentKey[] = ['VERSIONS_SHAPE', 'VERSIONS_TABLE_KEPT', 'OWN_CSS_LAYOUT', 'VERSIONS_MISSING'];
/** The comments that already cover a missing class from the exercise's table. */
const CLASS_COMMENTS: Record<string, CommentKey[]> = {
  'container-fluid': ['PAGE_NOT_FLUID', 'HORIZONTAL_SCROLL'],
  row: [...CARD_GRID, ...VERSIONS_GRID, 'POPULAR_NOT_ONE_ROW', 'POPULAR_NO_GRID', 'HORIZONTAL_SCROLL'],
  'col-12': ['CARDS_XS', 'OWN_CSS_LAYOUT'],
  'col-sm-6': CARD_GRID,
  'col-lg-4': CARD_GRID,
  'col-6': VERSIONS_GRID,
  'col-2': ['POPULAR_NOT_ONE_ROW', 'POPULAR_NO_GRID'],
  card: ['NO_CARD'],
  'h-100': ['CARD_UNEQUAL_HEIGHT'],
  'img-fluid': ['HEADER_IMG_OVERFLOW', 'POPULAR_IMG_OVERFLOW'],
  'd-none': VERSIONS_HIDE,
  'd-md-block': VERSIONS_HIDE,
  'g-0': ['VERSIONS_GUTTER', ...VERSIONS_GRID],
  'gy-4': ['CARDS_NO_GAP'],
  border: ['VERSIONS_CELLS', ...VERSIONS_GRID],
  'p-2': ['VERSIONS_CELLS', ...VERSIONS_GRID],
};

async function checkBootstrapLoaded(site: Site, g: Grader, state: BootstrapState) {
  const loaded = state.links.filter((l) => l.loaded);
  const old = loaded.find((l) => l.version !== undefined && l.version < 5);
  if (state.v4 || (old && !state.applied)) {
    g.flag(C.BOOTSTRAP_OLD_VERSION, old ? `href="${old.attr}"` : 'Bootstrap 4');
    return;
  }
  if (state.applied) return;
  // Without Bootstrap's classes there's nothing to fix: that is graded at the end (NO_BOOTSTRAP).
  if (state.gridElements === 0) return;

  const link = state.links[0];
  const failure = link && site.failedRequests.find((f) => f.url === link.href);
  if (failure && failure.status === undefined && /ERR_(INTERNET|NAME_NOT_RESOLVED|CONNECTION|TIMED_OUT|NETWORK|ADDRESS_UNREACHABLE)/.test(failure.error ?? '')) {
    // The grader's network, not the student's link.
    g.review(`Bootstrap לא נטען מהרשת (${failure.error}) – הדף נבדק עם Bootstrap ${BOOTSTRAP_VERSION} מקומי`);
  } else {
    const why = !link
      ? 'לא נמצא בדף קישור לקובץ ה-CSS של Bootstrap'
      : `href="${link.attr}"` +
        (failure?.status ? ` (הקובץ לא נמצא, ${failure.status})` : link.integrity ? ' (ערך ה-integrity אינו תואם לקובץ, ולכן הדפדפן חוסם אותו)' : '');
    g.flag(C.BOOTSTRAP_NOT_LOADED, why);
  }
  await injectBootstrap(site.page);
}

/** class="row,g-0" or class=".d-none": a Bootstrap class that doesn't apply because of the syntax. */
async function checkClassSyntax(page: Page, g: Grader) {
  const tokens = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[class]')).flatMap((el) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)),
  );
  const known = bootstrapClasses();
  const bad = [...new Set(tokens.filter((t) => /[.,]/.test(t) && t.split(/[.,]/).some((part) => known.has(part))))];
  if (bad.length) g.flag(C.CLASS_SYNTAX, summarize(bad.map((t) => `"${t}"`)));
}

/** Bootstrap-looking class names that Bootstrap 5 doesn't have (col-xs-12, col-ms-6) and the student's CSS doesn't define. */
async function checkUnknownClasses(page: Page, g: Grader) {
  const { tokens, own } = await page.evaluate(() => {
    const own: string[] = [];
    const collect = (list: CSSRuleList) => {
      for (const rule of Array.from(list)) {
        if (rule instanceof CSSStyleRule) own.push(...Array.from(rule.selectorText.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g), (m) => m[1]));
        else if ('cssRules' in rule) collect((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        if (!/bootstrap/i.test(sheet.href ?? '')) collect(sheet.cssRules);
      } catch {} // a cross-origin stylesheet can't be read
    }
    const tokens = Array.from(document.querySelectorAll('[class]')).flatMap((el) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean));
    return { tokens, own };
  });
  const known = bootstrapClasses();
  const ownSet = new Set(own);
  const unknown = [...new Set(tokens.filter((t) => !/[.,]/.test(t) && BOOTSTRAP_LIKE.test(t) && !known.has(t) && !ownSet.has(t)))];
  if (unknown.length) g.flag(C.UNKNOWN_CLASSES, summarize(unknown));
}

// ---------------------------------------------------------------------------------------------
// Regions

interface Region {
  found: boolean;
  exact: boolean;
  desc?: string;
}
interface CardInfo {
  label: string;
  desc: string;
  bootstrapCard: boolean;
  missing: string[];
  versions: { table: boolean; hideClasses: boolean; firstRow: string } | null;
}
interface Regions {
  page: Region;
  header: Region;
  headerImage: boolean;
  languages: Region;
  cards: Region & { count: number };
  cardInfo: CardInfo[];
  popular: Region;
  popularInfo: { heading: boolean; text: boolean; images: number };
}

/**
 * Finds the regions the spec asks for and tags them with data-grader="<region>":
 * page, header, header-img, languages (the row of the cards), card, col (each card's column),
 * versions (each card's versions area), popular, popular-row, popular-col, popular-img.
 * When a class is missing, a likely equivalent is used instead (reported as a 0-point note).
 */
function tagRegions(page: Page): Promise<Regions> {
  return page.evaluate(() => {
    const all = (sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<HTMLElement>(sel));
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
      el ? el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + Array.from(el.classList, (c) => `.${c}`).join('') : '';
    const region = (el: Element | null, exact: boolean) => ({ found: !!el, exact: !!el && exact, desc: describe(el) || undefined });
    const commonAncestor = (els: Element[]) => {
      if (!els.length) return null;
      let anc: Element | null = els[0].parentElement;
      while (anc && !els.every((e) => anc!.contains(e) && anc !== e)) anc = anc.parentElement;
      return anc as HTMLElement | null;
    };
    /** The ancestor of `el` (or `el` itself) whose parent is `container`. */
    const childOf = (container: Element, el: Element) => {
      let cur: Element = el;
      while (cur.parentElement && cur.parentElement !== container) cur = cur.parentElement;
      return cur.parentElement === container ? (cur as HTMLElement) : null;
    };
    const tag = (el: Element | null, name: string) =>
      el?.setAttribute('data-grader', `${el.getAttribute('data-grader') ?? ''} ${name}`.trim());
    const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

    // Cards: by Bootstrap's class, by the exercise's own class, or the innermost blocks holding a heading plus a list.
    const withHeading = (el: Element) => !!el.querySelector('h1, h2, h3, h4, h5, h6');
    let cards = all('.card').filter(withHeading);
    let cardsExact = false;
    if (!cards.length) {
      cards = all('.box').filter(withHeading);
    }
    cardsExact = cards.length > 0 && cards.every((c) => c.classList.contains('box'));
    if (!cards.length) {
      const candidates = all('body *').filter((el) => el.querySelector('h2, h3, h4') && el.querySelector('ul, ol, table'));
      cards = candidates.filter((el) => !candidates.some((other) => other !== el && el.contains(other)));
    }
    const touchesCard = (el: Element) => cards.some((b) => b.contains(el) || el.contains(b));

    // The cards' row: the closest element holding all of them; each card's column is its child there.
    const languages = cards.length > 1 ? commonAncestor(cards) : cards[0]?.parentElement ?? null;
    const languagesEl = languages && !isRoot(languages) ? languages : null;
    const cols = cards.map((c) => (languagesEl ? childOf(languagesEl, c) ?? c : c));

    // Header: by class, by a header-like name, or around the h1.
    let header = document.querySelector<HTMLElement>('.page-header');
    const headerExact = !!header;
    if (!header) header = pick(['header', '.header', '#header', '[class*="header" i]', '[id*="header" i]'], (el) => !isRoot(el) && !touchesCard(el));
    if (!header) {
      const h1 = document.querySelector<HTMLElement>('h1');
      const parent = h1?.parentElement ?? null;
      if (h1) header = !isRoot(parent) && !touchesCard(parent!) && !parent!.querySelector('ul, ol, table') && !parent!.classList.contains('row') ? parent : h1;
    }
    const headerImg = header?.querySelector('img, svg, picture') ?? null;
    const headerBgImage = !!header && [header, ...all('*', header)].some((e) => getComputedStyle(e).backgroundImage.includes('url('));

    // Popular languages: by class, by a popular/footer-like name, or the block with the most images.
    let popular = document.querySelector<HTMLElement>('.popular-languages');
    const popularExact = !!popular;
    const awayFromHeader = (el: Element) => !header || !(header.contains(el) || el.contains(header));
    if (!popular) {
      popular = pick(
        ['footer', '.footer', '#footer', '[class*="popular" i]', '[id*="popular" i]', '[class*="footer" i]'],
        (el) => !isRoot(el) && !touchesCard(el) && awayFromHeader(el),
      );
    }
    if (!popular) {
      const candidates = all('div, section, footer, aside, ul').filter((el) => el.querySelectorAll('img').length >= 3 && !touchesCard(el) && awayFromHeader(el));
      candidates.sort((a, b) => b.querySelectorAll('img').length - a.querySelectorAll('img').length || depth(a) - depth(b));
      popular = candidates[0] ?? null;
    }
    const popularImgs = popular ? all('img', popular) : [];
    const popularRow = popularImgs.length > 1 ? commonAncestor(popularImgs) : null;

    // Page wrapper: by class, by Bootstrap's container, or a top-level block that wraps all the regions.
    const parts = [header, languagesEl ?? cards[0], popular].filter((el): el is HTMLElement => !!el);
    const wraps = (w: Element) => parts.length > 1 && parts.every((p) => p !== w && w.contains(p));
    let pageEl = document.querySelector<HTMLElement>('.page');
    const pageExact = !!pageEl;
    if (!pageEl) pageEl = all('.container-fluid, .container').find(wraps) ?? null;
    if (!pageEl) pageEl = all('body > div, body > main, body > section, body > article').find(wraps) ?? null;

    // Each card's versions area (found in the DOM, so also when it is hidden): the outermost element
    // in the card with the versions text and links that holds none of the card's other parts.
    const versionsOf = (card: Element) => {
      // The description paragraph has no links; a versions area never holds it.
      const description = all('p', card).find((p) => !p.closest('table, ul, ol') && !p.querySelector('a') && text(p) !== '');
      const candidates = all('*', card).filter(
        (el) =>
          !el.matches('a, li, ul, ol') &&
          !el.closest('ul, ol') &&
          (el.querySelectorAll('a[href]').length >= 2 || /גי?רס/.test(text(el))) &&
          !el.querySelector('ul, ol, h1, h2, h3') &&
          !(description && el.contains(description)),
      );
      const outer = candidates.filter((el) => !candidates.some((o) => o !== el && o.contains(el)));
      return (
        outer.find((el) => /גי?רס|לינק/.test(text(el))) ??
        outer.find((el) => el.matches('table') || !!el.querySelector('table')) ??
        outer.find((el) => el.querySelectorAll('a[href]').length >= 2) ??
        null
      );
    };
    /** First row of a versions area: the first row of the table, or the first child after single wrappers. */
    const firstRow = (block: Element) => {
      const table = block.matches('table') ? (block as HTMLTableElement) : block.querySelector('table');
      if (table) return text(table.rows[0]);
      let container: Element = block;
      while (container.children.length === 1 && container.children[0].children.length > 0) container = container.children[0];
      return text(container.children[0]);
    };

    const cardInfo = cards.map((card, i) => {
      const label = (card.querySelector('h2') ?? card.querySelector('h1, h3, h4, h5, h6'))?.textContent?.trim().slice(0, 25) || `כרטיס ${i + 1}`;
      const block = versionsOf(card);
      const missing = [
        !card.querySelector('h2') && 'כותרת h2',
        !all('p', card).some((p) => !p.closest('table') && text(p) !== '') && 'פסקה',
        !all('h5', card).some((h) => text(h) !== '') && 'כותרת h5',
        !all('ul, ol', card).some((l) => l.querySelectorAll('a[href]').length >= 2) && 'רשימת קישורים',
      ].filter((x): x is string => !!x);
      // Display classes on the area, on its ancestors up to the column, or on its own rows.
      const display = /(^|[\s.,])d-(sm-|md-|lg-|xl-|xxl-)?(none|block|flex|inline|inline-block|grid)\b/;
      let hideClasses = !!block && all('[class]', block).some((el) => display.test(el.getAttribute('class') ?? ''));
      for (let el: Element | null = block; el && el !== cols[i]?.parentElement; el = el.parentElement) {
        if (display.test(el.getAttribute('class') ?? '')) hideClasses = true;
      }
      tag(block, 'versions');
      return {
        label,
        desc: describe(card),
        // Bootstrap 5's card variables (Bootstrap 4, reported on its own, has the class without them).
        bootstrapCard:
          getComputedStyle(card).getPropertyValue('--bs-card-spacer-y').trim() !== '' ||
          (card.classList.contains('card') && getComputedStyle(document.documentElement).getPropertyValue('--breakpoint-md').trim() !== ''),
        missing,
        versions: block ? { table: block.matches('table') || !!block.querySelector('table'), hideClasses, firstRow: firstRow(block) } : null,
      };
    });

    tag(pageEl, 'page');
    tag(header, 'header');
    tag(headerImg, 'header-img');
    tag(languagesEl, 'languages');
    cards.forEach((c) => tag(c, 'card'));
    cols.forEach((c) => tag(c, 'col'));
    tag(popular, 'popular');
    tag(popularRow, 'popular-row');
    popularImgs.forEach((img) => {
      tag(img, 'popular-img');
      tag(popularRow ? childOf(popularRow, img) ?? img : img, 'popular-col');
    });

    return {
      page: region(pageEl, pageExact),
      header: region(header, headerExact),
      headerImage: !!headerImg || headerBgImage,
      // The class may be on the row itself or on a wrapper around it.
      languages: region(languagesEl, !!languagesEl?.closest('.languages')),
      cards: { ...region(cards[0] ?? null, cardsExact), count: cards.length },
      cardInfo,
      popular: region(popular, popularExact),
      popularInfo: {
        heading: !!popular && (popular.matches('h1, h2, h3, h4, h5, h6') || !!popular.querySelector('h1, h2, h3, h4, h5, h6')),
        text: text(popular) !== '',
        images: popularImgs.length,
      },
    };
  });
}

/** The texts the spec asks for, matched loosely (keywords), on the elements that exist. */
function requiredTextsDiffer(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const norm = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const short = (text: string) => `"${text.length > 30 ? `${text.slice(0, 30)}…` : text}"`;
    const wrong: string[] = [];
    const h1 = document.querySelector('[data-grader~="header"] h1') ?? document.querySelector('h1');
    const title = norm(h1);
    if (h1 && !(title.includes('שפות') && title.includes('אתר'))) wrong.push(`כותרת ראשית: ${short(title)}`);
    const cards = Array.from(document.querySelectorAll('[data-grader~="card"]'));
    const h5 = cards.map((b) => norm(b.querySelector('h5'))).find((t) => t && !/לינקים|קישורים/.test(t));
    if (h5) wrong.push(`כותרת h5: ${short(h5)}`);
    const firstRow = (block: Element) => {
      const table = block.matches('table') ? (block as HTMLTableElement) : block.querySelector('table');
      if (table) return norm(table.rows[0]);
      let container: Element = block;
      while (container.children.length === 1 && container.children[0].children.length > 0) container = container.children[0];
      return norm(container.children[0]);
    };
    const headerRow = Array.from(document.querySelectorAll('[data-grader~="versions"]'))
      .map(firstRow)
      .find((t) => t && !(/גי?רס/.test(t) && /לינק|קישור|מידע/.test(t)));
    if (headerRow) wrong.push(`כותרות אזור הגרסאות: ${short(headerRow)}`);
    const popular = document.querySelector('[data-grader~="popular"]');
    if (popular) {
      const heading = popular.querySelector('h1, h2, h3, h4, h5, h6');
      const text = norm(heading ?? popular);
      if (!text.includes('פופולר')) wrong.push(`כותרת השפות הפופולריות: ${short(text || '(ריקה)')}`);
    }
    return wrong;
  });
}

/** float / clear left from exercise 1 on the regions (and their ::before/::after), where it no longer does anything. */
function floatLeftovers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const describe = (el: Element) => el.tagName.toLowerCase() + Array.from(el.classList, (c) => `.${c}`).join('');
    const sel = ['page', 'header', 'languages', 'card', 'col', 'popular', 'popular-row'].map((r) => `[data-grader~="${r}"]`).join(', ');
    for (const el of Array.from(document.querySelectorAll(sel))) {
      for (const pseudo of [null, '::before', '::after'] as const) {
        const cs = getComputedStyle(el, pseudo);
        if (pseudo && cs.content === 'none') continue;
        const name = describe(el) + (pseudo ?? '');
        if (cs.float !== 'none') out.push(`${name}: float: ${cs.float}`);
        if (cs.clear !== 'none') out.push(`${name}: clear: ${cs.clear}`);
      }
    }
    return out;
  });
}

// ---------------------------------------------------------------------------------------------
// Measurements

interface Cell {
  rect: Rect;
  border: boolean;
  padding: boolean;
  link: boolean;
  col: boolean;
}
interface VersionsSnap {
  visible: boolean;
  rect?: Rect;
  rows: { rect: Rect; row: boolean; cells: Cell[] }[];
}
interface Snapshot {
  width: number;
  /** How much wider the page is than the screen, in px. */
  overflow: number;
  overflowers: { desc: string; cause: 'header-img' | 'popular-img' | 'other' }[];
  page?: Rect;
  header?: Rect;
  headerImg?: Rect;
  languages?: Rect;
  /** Content-box width of the cards' row (its own padding doesn't count). */
  languagesWidth?: number;
  /** The page wrapper has container-fluid (a narrower page is then the student's own max-width from ex1). */
  pageFluid: boolean;
  cards: { label: string; rect: Rect; colRect: Rect; colInner?: Rect; colClasses: string; float: string; shadow: boolean; versions: VersionsSnap | null }[];
  popularRow?: Rect;
  popularRowWidth?: number;
  popularCols: Rect[];
  /** `room`: the content width of the image's column. */
  popularImgs: { rect: Rect; isCol: boolean; room: number }[];
  /** Content sticking out of the cards. */
  overflowing: { label: string; px: number }[];
}

/** Measures the page at every width in WIDTHS (with a screenshot of each in the report), then restores the size. */
async function measureWidths(page: Page): Promise<Record<WidthName, Snapshot>> {
  const original = page.viewportSize();
  const out = {} as Record<WidthName, Snapshot>;
  try {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w.width, height: 900 });
      await page.waitForTimeout(100);
      out[w.name] = { ...(await snapshot(page)), overflowing: (await boxOverflow(page, R('card'))).filter((b) => b.px > 4) };
      if (w.name !== 'xxl') {
        const shot = test.info().outputPath(`screenshot-${w.width}px.jpg`);
        await page.screenshot({ path: shot, fullPage: true, type: 'jpeg', quality: 70 });
        await test.info().attach(`screenshot-${w.width}px`, { path: shot, contentType: 'image/jpeg' });
      }
    }
  } finally {
    if (original) {
      await page.setViewportSize(original);
      await page.waitForTimeout(100);
    }
  }
  return out;
}

function snapshot(page: Page): Promise<Omit<Snapshot, 'overflowing'>> {
  return page.evaluate(() => {
    const q = (name: string) => document.querySelector<HTMLElement>(`[data-grader~="${name}"]`);
    const qa = (name: string, root: ParentNode = document) => Array.from(root.querySelectorAll<HTMLElement>(`[data-grader~="${name}"]`));
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left + scrollX, right: r.right + scrollX, top: r.top + scrollY, bottom: r.bottom + scrollY, width: r.width, height: r.height };
    };
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && r.width > 0 && r.height > 0;
    };
    const px = (v: string) => parseFloat(v) || 0;
    const describe = (el: Element) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + Array.from(el.classList, (c) => `.${c}`).join('');
    const isCol = (el: Element) => Array.from(el.classList).some((c) => /^col(-(sm|md|lg|xl|xxl))?(-(\d+|auto))?$/.test(c));
    const optRect = (el: Element | null) => (el && shown(el) ? rect(el) : undefined);
    /** Width of the content box: what percentage widths of flex items are relative to. */
    const contentWidth = (el: Element) => {
      const cs = getComputedStyle(el);
      return el.getBoundingClientRect().width - px(cs.paddingLeft) - px(cs.paddingRight) - px(cs.borderLeftWidth) - px(cs.borderRightWidth);
    };

    /** Rows of a versions area and their cells, skipping single wrappers. */
    const descend = (el: Element) => {
      let container = el;
      for (;;) {
        const kids = Array.from(container.children).filter(shown);
        if (kids.length === 1 && kids[0].children.length > 0 && !kids[0].matches('a')) container = kids[0];
        else return kids;
      }
    };
    const versions = (block: HTMLElement | null): Snapshot['cards'][number]['versions'] => {
      if (!block) return null;
      if (!shown(block)) return { visible: false, rows: [] };
      const rows = block.matches('table') || block.querySelector('table') ? [] : descend(block);
      return {
        visible: true,
        rect: rect(block),
        rows: rows.map((row) => ({
          rect: rect(row),
          row: row.classList.contains('row'),
          cells: descend(row).map((cell) => {
            const cs = getComputedStyle(cell);
            const sides = ['top', 'right', 'bottom', 'left'];
            return {
              rect: rect(cell),
              border: sides.some((s) => px(cs.getPropertyValue(`border-${s}-width`)) > 0 && cs.getPropertyValue(`border-${s}-style`) !== 'none'),
              padding: sides.some((s) => px(cs.getPropertyValue(`padding-${s}`)) > 0),
              link: cell.matches('a[href]') || !!cell.querySelector('a[href]'),
              col: isCol(cell),
            };
          }),
        })),
      };
    };

    const languages = q('languages');
    /** The card's column: its ancestor (or itself) whose parent is the cards' row. */
    const columnOf = (card: HTMLElement) => {
      let cur: HTMLElement = card;
      while (languages && cur.parentElement && cur.parentElement !== languages) cur = cur.parentElement;
      return languages && cur.parentElement === languages ? cur : card;
    };
    const cards = qa('card').map((card, i) => {
      const col = columnOf(card);
      const cs = getComputedStyle(card);
      const colCs = getComputedStyle(col);
      const colRect = rect(col);
      const colInner =
        col === card
          ? undefined
          : {
              ...colRect,
              left: colRect.left + px(colCs.paddingLeft) + px(colCs.borderLeftWidth),
              right: colRect.right - px(colCs.paddingRight) - px(colCs.borderRightWidth),
              width: colRect.width - px(colCs.paddingLeft) - px(colCs.paddingRight) - px(colCs.borderLeftWidth) - px(colCs.borderRightWidth),
            };
      return {
        label: (card.querySelector('h2') ?? card.querySelector('h1, h3, h4, h5, h6'))?.textContent?.trim().slice(0, 25) || `כרטיס ${i + 1}`,
        rect: rect(card),
        colRect,
        colInner,
        colClasses: col.getAttribute('class') ?? '',
        float: cs.float,
        shadow: cs.boxShadow !== 'none' || cs.filter.includes('drop-shadow'),
        versions: versions(qa('versions', card)[0] ?? null),
      };
    });

    // What makes the page wider than the screen: the outermost elements sticking out of it.
    const iw = innerWidth;
    const overflow = document.documentElement.scrollWidth - iw;
    let overflowers: Snapshot['overflowers'] = [];
    if (overflow > 1) {
      const out = Array.from(document.body.querySelectorAll('*')).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.right > iw + 1 || r.left < -1) && getComputedStyle(el).position !== 'fixed';
      });
      const outer = out.filter((el) => !out.includes(el.parentElement!));
      overflowers = outer.map((el) => ({
        desc: describe(el),
        cause: el.closest('[data-grader~="header-img"]') || el.querySelector('[data-grader~="header-img"]')
          ? 'header-img'
          : el.closest('[data-grader~="popular-img"]') || el.querySelector('[data-grader~="popular-img"]')
            ? 'popular-img'
            : 'other',
      }));
    }

    const popularImgs = qa('popular-img');
    const popularCols = qa('popular-col');
    const colOf = (img: HTMLElement) => popularCols.find((c) => c.contains(img)) ?? img;
    const popularRow = q('popular-row');
    return {
      width: iw,
      overflow,
      overflowers,
      page: optRect(q('page')),
      header: optRect(q('header')),
      headerImg: optRect(q('header-img')),
      languages: optRect(languages),
      languagesWidth: languages && shown(languages) ? contentWidth(languages) : undefined,
      pageFluid: !!q('page')?.classList.contains('container-fluid'),
      cards,
      popularRow: optRect(popularRow),
      popularRowWidth: popularRow && shown(popularRow) ? contentWidth(popularRow) : undefined,
      popularCols: popularImgs.map((img) => rect(colOf(img))),
      popularImgs: popularImgs.map((img) => ({ rect: rect(img), isCol: colOf(img) === img, room: contentWidth(colOf(img)) })),
    };
  });
}

/** Indexes of `rects` grouped into visual rows (a box starting below the current row's shortest box starts a new row). */
function lines(rects: Rect[]): number[][] {
  const order = rects.map((r, i) => i).sort((a, b) => rects[a].top - rects[b].top || rects[a].left - rects[b].left);
  const out: number[][] = [];
  let bottom = -Infinity;
  for (const i of order) {
    const r = rects[i];
    if (out.length && r.top < bottom - 2) {
      out[out.length - 1].push(i);
      bottom = Math.min(bottom, r.bottom);
    } else {
      out.push([i]);
      bottom = r.bottom;
    }
  }
  return out;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

// ---------------------------------------------------------------------------------------------
// Cards grid

interface GridState {
  ok: boolean;
  /** Every card but the last is right, and the last one fills the row. */
  lastFull: boolean;
  desc: string;
}

/** The cards' columns at one width compared with `perRow` per row, each 1/perRow of the row. */
function gridAt(s: Snapshot, perRow: number): GridState {
  const rects = s.cards.map((c) => c.colRect);
  const rowWidth = s.languagesWidth ?? Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left));
  const ratios = rects.map((r) => r.width / rowWidth);
  const groups = lines(rects);
  const fits = (r: number) => Math.abs(r - 1 / perRow) <= 0.06;
  const ok = groups.every((l, i) => l.length === perRow || (i === groups.length - 1 && l.length < perRow)) && ratios.every(fits);
  const lastFull =
    !ok &&
    rects.length > 1 &&
    ratios.slice(0, -1).every(fits) &&
    Math.abs(ratios[ratios.length - 1] - 1) <= 0.06 &&
    groups.slice(0, -1).every((l) => l.length === perRow);
  const perLine = groups.map((l) => l.length).join('+');
  const widths = [...new Set(ratios.map(pct))].join('/');
  return { ok, lastFull, desc: `ברוחב ${s.width}px: ${perLine} כרטיסים בשורות, רוחב ${widths} מהשורה (class="${s.cards[0]?.colClasses ?? ''}")` };
}

function checkCardsGrid(snaps: Record<WidthName, Snapshot>, g: Grader) {
  const grid = Object.fromEntries(WIDTHS.map((w) => [w.name, gridAt(snaps[w.name], w.perRow)])) as Record<WidthName, GridState>;
  if (!grid.xs.ok) g.flag(C.CARDS_XS, grid.xs.desc);
  if (!grid.sm.ok) {
    if (grid.sm.lastFull && (grid.md.ok || grid.md.lastFull)) g.flag(C.CARDS_SM_LAST, grid.sm.desc);
    else if (grid.md.ok) g.flag(C.CARDS_SM_FROM_MD, grid.sm.desc);
    else g.flag(C.CARDS_SM, [grid.sm.desc, grid.md.desc].join('; '));
  } else if (!grid.md.ok) g.flag(grid.md.lastFull ? C.CARDS_SM_LAST : C.CARDS_MD, grid.md.desc);
  if (!grid.lg.ok && grid.xxl.ok) g.flag(C.CARDS_LG_FROM_XL, grid.lg.desc);
  else if (!grid.lg.ok || !grid.xxl.ok) g.flag(C.CARDS_LG, (grid.lg.ok ? grid.xxl : grid.lg).desc);
}

// ---------------------------------------------------------------------------------------------
// Versions area

function checkVersionsVisibility(snaps: Record<WidthName, Snapshot>, regions: Regions, g: Grader) {
  const visibleAt = (name: WidthName) => snaps[name].cards.some((c) => c.versions?.visible);
  const hiddenAt = (name: WidthName) => snaps[name].cards.some((c) => c.versions && !c.versions.visible);
  const shownSmall = WIDTHS.filter((w) => !w.versions && visibleAt(w.name));
  const hiddenLarge = WIDTHS.filter((w) => w.versions && hiddenAt(w.name));
  const list = (ws: readonly { width: number }[]) => ws.map((w) => `${w.width}px`).join(', ');
  const largeCount = WIDTHS.filter((w) => w.versions).length;

  if (shownSmall.length === 0 && hiddenLarge.length === largeCount) {
    g.flag(C.VERSIONS_ALWAYS_HIDDEN);
    return;
  }
  if (shownSmall.length === 2) {
    const classes = regions.cardInfo.some((c) => c.versions?.hideClasses);
    g.flag(classes ? C.VERSIONS_HIDE_BROKEN : C.VERSIONS_NOT_HIDDEN, `מוצג ברוחב ${list(shownSmall)}`);
  } else if (shownSmall.length === 1) g.flag(C.VERSIONS_HIDE_ONE_SIZE, `מוצג ברוחב ${list(shownSmall)}`);
  if (hiddenLarge.length) g.flag(C.VERSIONS_HIDDEN_AT_MD, `מוסתר ברוחב ${list(hiddenLarge)}`);
}

/** The versions areas at the first large width where they show (tables excluded: reported on their own). */
function shownVersions(snaps: Record<WidthName, Snapshot>) {
  for (const name of ['xxl', 'lg', 'md'] as const) {
    const blocks = snaps[name].cards.flatMap((c) => (c.versions?.visible && c.versions.rows.length ? [{ label: c.label, ...c.versions }] : []));
    if (blocks.length) return blocks;
  }
  return [];
}

/** Rows that are two cells side by side, each about half of the row. */
function rowShapeOk(row: VersionsSnap['rows'][number]): boolean {
  if (row.cells.length !== 2) return false;
  const [a, b] = row.cells.map((c) => c.rect);
  return inOneRow([a, b]) && [a, b].every((r) => Math.abs(r.width / row.rect.width - 0.5) <= 0.1);
}

function checkVersionsGrid(snaps: Record<WidthName, Snapshot>, g: Grader) {
  const blocks = shownVersions(snaps);
  if (!blocks.length) return;
  const badShape = blocks.filter((b) => b.rows.length < 3 || !b.rows.every(rowShapeOk));
  if (badShape.length) {
    const b = badShape[0];
    const cells = b.rows.map((r) => r.cells.length).join('+');
    const stacked = b.rows.some((r) => r.cells.length === 2 && !inOneRow(r.cells.map((c) => c.rect)));
    g.flag(C.VERSIONS_SHAPE, `${b.label}: ${b.rows.length} שורות, תאים בכל שורה: ${cells}${stacked ? ' (התאים זה מתחת לזה)' : ''}`);
    return;
  }
  const cells = blocks.flatMap((b) => b.rows.flatMap((r) => r.cells));
  const missing = [cells.some((c) => !c.border) && 'מסגרת', cells.some((c) => !c.padding) && 'ריפוד'].filter(Boolean);
  if (missing.length) g.flag(C.VERSIONS_CELLS, `לתאים חסרים: ${missing.join(' ו')}`);
  const outside = blocks.filter((b) =>
    b.rows.some((r) => {
      const [a, c] = [...r.cells].sort((x, y) => x.rect.left - y.rect.left).map((x) => x.rect);
      return a.left < b.rect!.left - 1 || c.right > b.rect!.right + 1 || c.left - a.right > 1;
    }),
  );
  if (outside.length) g.flag(C.VERSIONS_GUTTER, summarize(outside.map((b) => b.label)));
  const noLinks = blocks.filter((b) => b.rows.slice(1).some((r) => !r.cells.some((c) => c.link)));
  if (noLinks.length) g.flag(C.VERSIONS_NO_LINKS, summarize(noLinks.map((b) => b.label)));
}

// ---------------------------------------------------------------------------------------------
// Popular languages

function checkPopularRow(snaps: Record<WidthName, Snapshot>, g: Grader) {
  // Images straight in a row (inline, or a flex box of their own) have no columns to compare.
  const inColumns = !snaps.xxl.popularImgs.every((img) => img.isCol);
  const bad = WIDTHS.flatMap((w) => {
    const s = snaps[w.name];
    const cols = s.popularCols;
    const widths = cols.map((c) => c.width);
    const oneRow = lines(cols).length === 1 && inOneRow(cols);
    const equal = !inColumns || Math.max(...widths) / Math.max(1, Math.min(...widths)) <= 1.1;
    if (oneRow && equal) return [];
    return [`ברוחב ${s.width}px: ${oneRow ? 'העמודות ברוחב שונה' : `התמונות ב-${lines(cols).length} שורות`}`];
  });
  if (bad.length) {
    g.flag(C.POPULAR_NOT_ONE_ROW, summarize(bad, 3) + (inColumns ? '' : ' (התמונות אינן בעמודות col-2)'));
    return;
  }
  // In one row at every width: are the images in columns that divide the row (or just next to each other)?
  const s = snaps.xxl;
  const rowWidth = s.popularRowWidth ?? 0;
  const used = s.popularCols.reduce((n, c) => n + c.width, 0);
  if (!inColumns) g.flag(C.POPULAR_NO_GRID, 'התמונות אינן בתוך עמודות');
  else if (rowWidth && used < 0.9 * rowWidth) g.flag(C.POPULAR_NO_GRID, `העמודות תופסות ${pct(used / rowWidth)} מרוחב השורה`);
}

// ---------------------------------------------------------------------------------------------
// Bootstrap vs own CSS

/** Areas whose layout works (no comment on them) but has no Bootstrap classes. */
function ownCssAreas(regions: Regions, snaps: Record<WidthName, Snapshot>, g: Grader): string[] {
  const has = (...keys: CommentKey[]) => keys.some((k) => g.has(C[k]));
  const areas: string[] = [];
  const s = snaps.xxl;

  const cols = s.cards.map((c) => c.colClasses.split(/\s+/));
  const gridClasses = cols.length > 1 && cols.every((cls) => cls.some((c) => COL_CLASS.test(c)));
  const gridComments: CommentKey[] = ['CARDS_XS', 'CARDS_SM', 'CARDS_SM_FROM_MD', 'CARDS_SM_LAST', 'CARDS_MD', 'CARDS_LG', 'CARDS_LG_FROM_XL'];
  if (regions.cards.count > 1 && !has(...gridComments) && !gridClasses) areas.push('חלוקת הכרטיסים לעמודות (row / col-*)');

  const withVersions = regions.cardInfo.filter((c) => c.versions);
  const hideComments: CommentKey[] = ['VERSIONS_NOT_HIDDEN', 'VERSIONS_HIDE_BROKEN', 'VERSIONS_HIDE_ONE_SIZE', 'VERSIONS_HIDDEN_AT_MD', 'VERSIONS_ALWAYS_HIDDEN'];
  if (withVersions.length && !has(...hideComments) && !withVersions.some((c) => c.versions!.hideClasses)) {
    areas.push('הסתרת אזור הגרסאות (d-none d-md-block)');
  }

  const blocks = shownVersions(snaps);
  const cells = blocks.flatMap((b) => b.rows.flatMap((r) => r.cells));
  if (blocks.length && !has('VERSIONS_SHAPE', 'VERSIONS_TABLE_KEPT') && !(cells.every((c) => c.col) && blocks.every((b) => b.rows.every((r) => r.row)))) {
    areas.push('שורות ותאים באזור הגרסאות (row g-0 / col-6)');
  }
  return areas;
}
