import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { bootstrapClasses } from '../../grader/bootstrap';
import { expect, openSite, test } from '../../grader/fixtures';
import { Grader } from '../../grader/grader';
import { gradeOf } from '../../grader/output';
import { ROOT } from '../../grader/paths';
import { checkProtocol } from '../../grader/protocol';
import type { PROTOCOL_C } from '../../grader/protocol-comments';
import type { StudentResult } from '../../grader/types';
import { gradeEx2 } from './checks';
import { C } from './comments';

/**
 * Grades the reference solution (exercise 2/ex2Solution, written from the exercise PDF) and
 * mutated copies of it, and asserts the exact set of comments: the grader must not be too strict
 * (the solution gets 100) and each check must catch what it is meant to catch, without cascading
 * into other comments. Every case runs with the network blocked: Bootstrap 5.3.3 comes from
 * node_modules (grader/bootstrap.ts).
 */

type Edit = [from: string | RegExp, to: string]; // strings are replaced everywhere

interface Case {
  name: string;
  html?: Edit[];
  css?: Edit[];
  /** Runs after the edits, e.g. to add or move files. */
  setup?: (dir: string) => void;
  /** Start from another folder instead of the reference solution. */
  from?: string;
  expected: (keyof typeof C | keyof typeof PROTOCOL_C)[];
  grade?: number;
  /** The case is expected to ask for manual review. */
  review?: boolean;
}

const SOLUTION = path.join(ROOT, 'exercise 2', 'ex2Solution');
const EX1_SOLUTION = path.join(ROOT, 'exercise 1', 'ex1Solution');
const BOOTSTRAP_FILE = path.join(path.dirname(require.resolve('bootstrap/package.json')), 'dist', 'css', 'bootstrap.rtl.min.css');
const CDN_LINK = /<link\s+rel="stylesheet"\s+href="https:\/\/cdn\.jsdelivr\.net\/npm\/bootstrap@5\.3\.3\/dist\/css\/bootstrap\.rtl\.min\.css"\s*>/;
const CDN_HREF = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.rtl.min.css';
const STYLE_LINK = '<link rel="stylesheet" href="style.css">';
const CARD_COLS = 'class="col-12 col-sm-6 col-lg-4"';
/** One card's whole versions area: a wrapper with three rows of two cells. */
const VERSIONS_BLOCK = /<div class="d-none d-md-block">(?:\s*<div class="row g-0[^"]*">(?:\s*<div class="col-6 border p-2">[\s\S]*?<\/div>){2}\s*<\/div>){3}\s*<\/div>/g;
const appendCss = (rule: string): Edit => [/$/, `\r\n${rule}\r\n`];
const sri = (file: string) => `sha384-${crypto.createHash('sha384').update(fs.readFileSync(file)).digest('base64')}`;

/** A versions area written as ex1's table (inside the hiding wrapper). */
const TABLE = `<div class="d-none d-md-block">
                            <table>
                                <tr><th>גרסאות מתקדמות</th><th>לינק למידע</th></tr>
                                <tr><td>XHTML</td><td><a href="https://www.w3schools.com/html/html_xhtml.asp">מידע על XHTML</a></td></tr>
                                <tr><td>HTML5</td><td><a href="https://developer.mozilla.org/en-US/docs/Glossary/HTML5">מידע על HTML5</a></td></tr>
                            </table>
                        </div>`;

const cases: Case[] = [
  { name: 'reference solution', expected: [], grade: 100 },

  // Bootstrap setup
  { name: 'Bootstrap link removed (classes kept)', html: [[CDN_LINK, '']], expected: ['BOOTSTRAP_NOT_LOADED'], grade: 97 },
  { name: 'Bootstrap link to a missing local file', html: [[CDN_HREF, 'css/bootstrap.rtl.min.css']], expected: ['BOOTSTRAP_NOT_LOADED'] },
  {
    name: 'Bootstrap link with a wrong integrity value',
    html: [[`href="${CDN_HREF}"`, `href="${CDN_HREF}" integrity="sha384-${'A'.repeat(64)}" crossorigin="anonymous"`]],
    expected: ['BOOTSTRAP_NOT_LOADED'],
  },
  {
    // The file from node_modules is the CDN's, byte for byte: a correct integrity value still matches.
    name: 'Bootstrap link with the correct integrity value',
    html: [[`href="${CDN_HREF}"`, `href="${CDN_HREF}" integrity="${sri(BOOTSTRAP_FILE)}" crossorigin="anonymous"`]],
    expected: [],
  },
  { name: 'bootstrap.min.css instead of the RTL file', html: [['bootstrap.rtl.min.css', 'bootstrap.min.css']], expected: ['BOOTSTRAP_NOT_RTL'] },
  {
    name: 'style.css linked before Bootstrap',
    html: [[STYLE_LINK, ''], [CDN_LINK, `${STYLE_LINK}\r\n    <link rel="stylesheet" href="${CDN_HREF}">`]],
    expected: ['BOOTSTRAP_AFTER_STYLE'],
  },
  { name: 'no viewport meta', html: [[/<meta name="viewport"[^>]*>/, '']], expected: ['NO_VIEWPORT'] },
  { name: 'no lang on html', html: [[' lang="he"', '']], expected: ['NO_LANG'], grade: 100 },
  { name: 'no dir on html', html: [[' dir="rtl"', '']], expected: ['NO_RTL'] },
  {
    // Other versions come from the network: when it is down that's the grader's problem, not the student's.
    name: "the lecture's Bootstrap 5.3.7 while the network is down",
    html: [['bootstrap@5.3.3', 'bootstrap@5.3.7']],
    expected: [],
    review: true,
  },
  {
    name: 'Bootstrap copied into the zip and linked locally',
    html: [[CDN_HREF, 'css/bootstrap.rtl.min.css']],
    setup: (dir) => copyBootstrap(dir),
    expected: [],
  },

  // Page structure
  { name: 'container instead of container-fluid', html: [['page container-fluid', 'page container']], expected: ['PAGE_NOT_FLUID'] },
  {
    name: 'rows directly in body (no container)',
    html: [['<div class="page container-fluid">', ''], [/<\/div>(\s*<\/body>)/, '$1']],
    expected: ['HORIZONTAL_SCROLL'],
  },
  { name: 'versions header texts in English', html: [[/>גרסאות מתקדמות</g, '>Versions<'], [/>לינק למידע</g, '>Link<']], expected: ['REQUIRED_TEXTS'] },

  // Cards grid
  { name: 'col-md-6 instead of col-sm-6', html: [[CARD_COLS, 'class="col-12 col-md-6 col-lg-4"']], expected: ['CARDS_SM_FROM_MD'], grade: 98 },
  { name: 'no col-sm-6', html: [[CARD_COLS, 'class="col-12 col-lg-4"']], expected: ['CARDS_SM'], grade: 96 },
  {
    name: 'last card col-sm-12',
    html: [[`<!-- JavaScript -->\n            <div ${CARD_COLS}>`, '<!-- JavaScript -->\n            <div class="col-12 col-sm-12 col-lg-4">']],
    expected: ['CARDS_SM_LAST'],
  },
  { name: 'col-xl-4 instead of col-lg-4', html: [[CARD_COLS, 'class="col-12 col-sm-6 col-xl-4"']], expected: ['CARDS_LG_FROM_XL'] },
  { name: 'three cards per row already at md', html: [[CARD_COLS, 'class="col-12 col-sm-6 col-md-4 col-lg-4"']], expected: ['CARDS_MD'] },
  { name: 'no col-lg-4', html: [[CARD_COLS, 'class="col-12 col-sm-6"']], expected: ['CARDS_LG'] },
  { name: 'no col classes on the cards at all', html: [[CARD_COLS, 'class=""']], expected: ['CARDS_SM', 'CARDS_LG'] },
  // `.row > *` already makes every column full width: col-12 changes nothing.
  { name: 'cards without col-12', html: [[CARD_COLS, 'class="col-sm-6 col-lg-4"']], expected: [] },
  { name: 'col-xs-12 (not in Bootstrap 5)', html: [[CARD_COLS, 'class="col-xs-12 col-sm-6 col-lg-4"']], expected: ['UNKNOWN_CLASSES'] },
  {
    name: 'cards grid made with own media queries',
    html: [[CARD_COLS, 'class="lang-col"']],
    css: [appendCss('.lang-col { width: 100%; } @media (min-width: 576px) { .lang-col { width: 50%; } } @media (min-width: 992px) { .lang-col { width: 33.3333%; } }')],
    expected: ['OWN_CSS_LAYOUT'],
  },

  // Cards
  { name: 'no h-100', html: [['card h-100 box', 'card box']], expected: ['CARD_UNEQUAL_HEIGHT'] },
  { name: 'no gy-4', html: [['row gy-4 languages', 'row languages']], expected: ['CARDS_NO_GAP'] },
  { name: 'no card class', html: [['card h-100 box', 'h-100 box']], expected: ['NO_CARD'] },
  { name: 'no card-body', html: [['<div class="card-body">', '<div>']], expected: ['BOOTSTRAP_CLASSES'], grade: 100 },
  { name: 'card without the box class', html: [['card h-100 box', 'card h-100']], expected: ['CLASS_NAMES', 'CARD_NO_SHADOW'] },
  {
    name: "ex1's float, width and margins left on .box",
    css: [['.box {\n    padding: 20px;', '.box {\n    float: right;\n    width: 30%;\n    margin: 0 1.66%;\n    padding: 20px;']],
    expected: ['BOX_OLD_LAYOUT'],
  },
  { name: "ex1's clear left on the popular area", css: [['.popular-languages {', '.popular-languages {\n    clear: both;']], expected: ['OLD_FLOAT_CSS'], grade: 100 },
  { name: "ex1's clearfix left on the cards' row", css: [appendCss('.languages::after { content: ""; display: block; clear: both; }')], expected: ['OLD_FLOAT_CSS'] },
  { name: 'no card shadow', css: [[/box-shadow:[^;]*;/, '']], expected: ['CARD_NO_SHADOW'] },
  {
    name: 'languages class on a wrapper around the cards row',
    html: [['<div class="row gy-4 languages">', '<div class="languages">\n        <div class="row gy-4">'], [/(\s*<!-- שורה שלישית)/, '</div>$1']],
    expected: [],
  },
  // cgroup62, cgroup68: padding on the cards' row; the columns are measured against its content box.
  { name: "padding on the cards' row", css: [['.languages {\n    padding-top: 20px;', '.languages {\n    padding: 20px;']], expected: [] },
  // cgroup50, cgroup57: ex1's max-width kept on .page, which has container-fluid.
  { name: "ex1's max-width kept on a container-fluid page", css: [appendCss('.page { max-width: 1200px; margin: 0 auto; }')], expected: [] },
  { name: "ex1's margin on the cards' row", css: [['.languages {\n    padding-top: 20px;\n    padding-bottom: 20px;\n}', '.languages {\n    margin: 20px 0;\n}']], expected: [] },

  // Versions area
  {
    name: 'table kept in a card',
    html: [[/<div class="d-none d-md-block">(?:\s*<div class="row g-0[^"]*">(?:\s*<div class="col-6 border p-2">[\s\S]*?<\/div>){2}\s*<\/div>){3}\s*<\/div>/, TABLE]],
    expected: ['VERSIONS_TABLE_KEPT'],
  },
  { name: 'versions areas removed', html: [[VERSIONS_BLOCK, '']], expected: ['VERSIONS_MISSING'], grade: 92 },
  { name: 'versions area never hidden', html: [['<div class="d-none d-md-block">', '<div>']], expected: ['VERSIONS_NOT_HIDDEN'], grade: 95 },
  {
    name: 'hiding classes written with dots',
    html: [['<div class="d-none d-md-block">', '<div class=".d-none .d-md-block">']],
    expected: ['VERSIONS_HIDE_BROKEN', 'CLASS_SYNTAX'],
    grade: 98,
  },
  { name: 'hidden only at sm', html: [['<div class="d-none d-md-block">', '<div class="d-sm-none d-md-block">']], expected: ['VERSIONS_HIDE_ONE_SIZE'] },
  { name: 'shown only from lg', html: [['<div class="d-none d-md-block">', '<div class="d-none d-lg-block">']], expected: ['VERSIONS_HIDDEN_AT_MD'] },
  { name: 'hidden at every width', html: [['<div class="d-none d-md-block">', '<div class="d-none">']], expected: ['VERSIONS_ALWAYS_HIDDEN'] },
  {
    name: 'versions area hidden with own media query',
    html: [['<div class="d-none d-md-block">', '<div class="versions">']],
    css: [appendCss('.versions { display: none; } @media (min-width: 768px) { .versions { display: block; } }')],
    expected: ['OWN_CSS_LAYOUT'],
  },
  {
    name: 'hiding classes on each versions row instead of the wrapper',
    html: [['<div class="d-none d-md-block">', '<div>'], [/class="row g-0/g, 'class="row g-0 d-none d-md-flex']],
    expected: ['BOOTSTRAP_CLASSES'], // d-md-flex instead of d-md-block: a note only
    grade: 100,
  },
  { name: 'versions rows without g-0', html: [['row g-0', 'row']], expected: ['VERSIONS_GUTTER'] },
  { name: 'versions cells without border', html: [['col-6 border p-2', 'col-6 p-2']], expected: ['VERSIONS_CELLS'] },
  { name: 'versions rows without row', html: [['row g-0', 'g-0']], expected: ['VERSIONS_SHAPE'] },
  { name: 'row,g-0 with a comma', html: [['row g-0', 'row,g-0']], expected: ['VERSIONS_SHAPE', 'CLASS_SYNTAX'] },
  { name: 'versions links removed', html: [[/<a href="([^"]*)">(מידע על [^<]*)<\/a>/g, '$2']], expected: ['VERSIONS_NO_LINKS'] },

  // Popular languages
  {
    name: 'popular images inline, without row and col-2',
    html: [[/<div class="col-2">\s*(<img[^>]*>)\s*<\/div>/g, '$1'], ['class="row language-images"', 'class="language-images"']],
    css: [['.language-images img {\n    max-height: 70px;\n}', '.language-images img {\n    width: 12%;\n    max-width: 100px;\n    height: auto;\n    margin: 0 1%;\n}']],
    expected: ['POPULAR_NO_GRID'],
  },
  {
    // cgroup69: Bootstrap's d-flex around the images instead of a row of col-2 columns.
    name: 'popular images in a d-flex box of their own',
    html: [[/<div class="col-2">\s*(<img[^>]*)class="img-fluid">\s*<\/div>/g, '$1class="footer-img">'], ['class="row language-images"', 'class="d-flex justify-content-center align-items-center gap-3"']],
    css: [appendCss('.footer-img { height: 40px; width: auto; max-width: 50px; object-fit: contain; }')],
    expected: ['POPULAR_NO_GRID'],
  },
  { name: 'popular images two per row on phones', html: [['class="col-2"', 'class="col-6 col-md-2"']], expected: ['POPULAR_NOT_ONE_ROW'] },
  {
    name: 'popular images without img-fluid',
    html: [[/(<img src="images\/(?!imgPage)[^"]*" alt="[^"]*") class="img-fluid">/g, '$1>']],
    expected: ['POPULAR_IMG_OVERFLOW'],
  },
  {
    name: 'header image 600px wide without img-fluid',
    html: [['alt="HTML, CSS, JavaScript" class="img-fluid"', 'alt="HTML, CSS, JavaScript"']],
    css: [['.page-header img {\n    max-height: 85px;\n}', '.page-header img {\n    width: 600px;\n}']],
    expected: ['HEADER_IMG_OVERFLOW'],
  },

  // Shared checks (grader/common-checks.ts)
  { name: 'a few inline styles', html: [[/<p>/, '<p style="font-style: normal">']], expected: ['INLINE_FEW'] },
  { name: 'broken style.css link (design still graded)', html: [['href="style.css"', 'href="css/style.css"']], expected: ['CSS_LINK_BROKEN'] },
  {
    name: 'own CSS in a <style> tag, Bootstrap copied into the zip',
    html: [[CDN_HREF, 'css/bootstrap.rtl.min.css']],
    setup: (dir) => {
      copyBootstrap(dir);
      const css = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');
      fs.rmSync(path.join(dir, 'style.css'));
      edit(path.join(dir, 'index.html'), [[STYLE_LINK, `<style>\r\n${css}\r\n</style>`]]);
    },
    expected: ['NO_EXTERNAL_CSS'],
  },
  {
    name: "last year's title and classes",
    html: [
      ['<h1>שפות לפיתוח אתרים</h1>', '<h1>קורס פיתוח מערכות אינטרנטיות - צד לקוח (Frontend developer)</h1>'],
      [/<li>/g, '<li class="list-group-item">'],
    ],
    expected: ['LAST_YEAR'],
    review: true,
  },

  // Exercise 1 handed in again: no Bootstrap at all.
  {
    // Every symptom of a page that isn't responsive is reported; the grader is asked to look at it.
    name: "exercise 1's solution handed in as exercise 2",
    from: EX1_SOLUTION,
    expected: [
      'NO_BOOTSTRAP',
      'NO_HEADER_IMG', // the official ex1 solution has none
      'NO_CARD',
      'CARD_UNEQUAL_HEIGHT',
      'CARDS_XS',
      'CARDS_SM',
      'BOX_OVERFLOW',
      'HORIZONTAL_SCROLL',
      'VERSIONS_TABLE_KEPT',
      'VERSIONS_NOT_HIDDEN',
      'POPULAR_NO_GRID',
    ],
    grade: 69,
    review: true,
  },
];


for (const c of cases) {
  test(c.name, async ({ page }, info) => {
    const dir = info.outputPath('site');
    fs.cpSync(c.from ?? SOLUTION, dir, { recursive: true });
    edit(path.join(dir, 'index.html'), c.html ?? []);
    edit(path.join(dir, 'style.css'), c.css ?? []);
    c.setup?.(dir);

    await blockNetwork(page);
    const submission = { id: 'selftest', source: c.name, rootDir: dir, entry: 'index.html' };
    const g = new Grader(info, { softAssert: false });
    const site = await openSite(page, submission, info);
    try {
      await gradeEx2(site, g);
      await checkProtocol(site, g); // without a mail only the extra-files rule applies
    } finally {
      await site.close();
    }

    const result = g.result(submission);
    expect(result.flags.map((f) => f.key).sort(), explain(result)).toEqual([...c.expected].sort());
    if (!c.review) expect(result.review, explain(result)).toEqual([]);
    else expect(result.review.length, explain(result)).toBeGreaterThan(0);
    if (c.grade !== undefined) expect(gradeOf(result)).toBe(c.grade);
  });
}

test('Bootstrap class names come from the installed Bootstrap', () => {
  const classes = bootstrapClasses();
  for (const name of ['row', 'col-12', 'col-sm-6', 'col-lg-4', 'col-2', 'card', 'card-body', 'h-100', 'img-fluid', 'd-none', 'd-md-block', 'g-0', 'gy-4', 'border', 'p-2', 'container-fluid']) {
    expect(classes.has(name), name).toBe(true);
  }
  for (const name of ['col-xs-12', 'col-ms-6', 'no-gutters', 'w3', 'org']) expect(classes.has(name), name).toBe(false);
});

/** Any request that would leave the machine fails: the grading must not need the network. */
async function blockNetwork(page: Page) {
  // Routes added later win, so openSite's Bootstrap route still answers from node_modules first.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort('internetdisconnected'));
}

function copyBootstrap(dir: string) {
  fs.mkdirSync(path.join(dir, 'css'), { recursive: true });
  fs.copyFileSync(BOOTSTRAP_FILE, path.join(dir, 'css', 'bootstrap.rtl.min.css'));
}

function edit(file: string, edits: Edit[]) {
  let text = fs.readFileSync(file, 'utf8');
  for (const [from, to] of edits) {
    const next = typeof from === 'string' ? text.split(from).join(to) : text.replace(from, to);
    if (next === text) throw new Error(`mutation did not apply to ${path.basename(file)}: ${from}`);
    text = next;
  }
  fs.writeFileSync(file, text);
}

function explain(result: StudentResult): string {
  const flags = result.flags.map((f) => `${f.key}${f.detail ? ` (${f.detail})` : ''}`);
  return `flags: ${flags.join('; ') || 'none'}\nreview: ${result.review.join('; ') || 'none'}`;
}
