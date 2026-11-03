import fs from 'node:fs';
import path from 'node:path';
import { expect, openSite, test } from '../../grader/fixtures';
import { Grader } from '../../grader/grader';
import { gradeOf } from '../../grader/output';
import { ROOT } from '../../grader/paths';
import type { StudentResult } from '../../grader/types';
import { gradeEx1 } from './checks';
import { C } from './comments';

/**
 * Grades the official solution and mutated copies of it, and asserts the exact set of comments.
 * Guards both directions: the grader must not be too strict (the solution passes) and each
 * check must catch what it is meant to catch, without cascading into other comments.
 */

type Edit = [from: string | RegExp, to: string]; // strings are replaced everywhere

interface Case {
  name: string;
  html?: Edit[];
  css?: Edit[];
  /** Runs after the edits, e.g. to delete or rename files. */
  setup?: (dir: string) => void;
  entry?: string;
  expected: (keyof typeof C)[];
  grade?: number;
  /** The case is expected to ask for manual review. */
  review?: boolean;
  /** The official solution has no header image; every other case adds one first. */
  headerImage?: false;
}

const SOLUTION = path.join(ROOT, 'exercise 1', 'ex1Solution');
const HEADER_IMAGE: Edit = [
  '<h1>שפות לפיתוח אתרים</h1>',
  '<h1>שפות לפיתוח אתרים</h1>\r\n            <img src="images/imgPage.png" alt="HTML, CSS, JavaScript">',
];
const appendCss = (rule: string): Edit => [/$/, `\r\n${rule}\r\n`];

const cases: Case[] = [
  { name: 'official solution as is', headerImage: false, expected: ['NO_HEADER_IMG'], grade: 99 },
  { name: 'official solution with a header image', expected: [], grade: 100 },

  // Files and inline styles
  { name: 'main file not named index.html', entry: 'ex1.html', setup: (dir) => rename(dir, 'index.html', 'ex1.html'), expected: ['MAIN_FILE_NAME'] },
  { name: 'broken stylesheet link (design still graded)', html: [['href="style.css"', 'href="css/style.css"']], expected: ['CSS_LINK_BROKEN'] },
  { name: 'CSS in a <style> tag', setup: moveCssIntoStyleTag, expected: ['NO_EXTERNAL_CSS'] },
  { name: 'image path in different case', html: [['src="images/react.png"', 'src="images/React.PNG"']], expected: ['PATH_CASE'] },
  { name: 'a few inline styles', html: [[/<p>/, '<p style="font-style: normal">'], [/<p>/, '<p style="font-style: normal">']], expected: ['INLINE_FEW'] },
  { name: 'many inline styles', html: [['<p>', '<p style="font-style: normal">'], ['<h5>', '<h5 style="font-style: normal">']], expected: ['INLINE_MANY'] },

  // Structure
  { name: 'no rtl', html: [[' dir="rtl"', '']], expected: ['NO_RTL'] },
  { name: 'duplicate id', html: [['<div class="box">', '<div class="box" id="lang">']], expected: ['DUPLICATE_ID'] },
  { name: 'boxes with a different class name', html: [['class="box"', 'class="card"']], css: [['.box', '.card']], expected: ['CLASS_NAMES'] },
  {
    name: "last year's class names and title",
    html: [
      ['class="page-header"', 'class="header"'],
      ['class="languages"', 'class="container"'],
      ['class="popular-languages"', 'class="footer"'],
      ['class="language-images"', 'class="footer-images"'],
      ['<h1>שפות לפיתוח אתרים</h1>', '<h1>קורס פיתוח מערכות אינטרנטיות - צד לקוח (Frontend developer)</h1>'],
    ],
    css: [
      ['.page-header', '.header'],
      ['.languages', '.container'],
      ['.popular-languages', '.footer'],
      ['.language-images', '.footer-images'],
    ],
    expected: ['CLASS_NAMES', 'LAST_YEAR'],
    review: true,
  },
  { name: 'no header area', html: [[/<div class="page-header">[\s\S]*?<\/div>/, '']], expected: ['NO_HEADER'] },
  { name: 'one box missing', html: [[/<!-- JavaScript -->[\s\S]*?<\/table>\s*<\/div>/, '']], expected: ['FEW_BOXES'], grade: 97 },
  { name: 'a box without a table', html: [[/<table>[\s\S]*?<\/table>/, '']], expected: ['BOX_NO_TABLE'] },
  { name: 'table header row with td', html: [['<th scope="col">', '<td>'], ['</th>', '</td>']], expected: ['TABLE_TD_HEADER'] },
  { name: 'ol instead of ul', html: [['<ul>', '<ol>'], ['</ul>', '</ol>']], expected: ['BOX_OL'] },
  {
    name: 'only four popular images',
    html: [
      [/<img\s+src="images\/react\.png"[^>]*>/, ''],
      [/<img\s+src="images\/sql-5\.png"[^>]*>/, ''],
    ],
    expected: ['POPULAR_FEW_IMGS'],
    grade: 98,
  },

  // Images
  { name: 'missing image file', setup: (dir) => fs.rmSync(path.join(dir, 'images', 'sql-5.png')), expected: ['IMG_BROKEN_ONE'] },
  { name: 'stretched images', css: [appendCss('.language-images img { height: 100px; }')], expected: ['IMG_STRETCHED'] },

  // Design
  { name: 'no font', css: [['font-family: Calibri, Arial, sans-serif;', '']], expected: ['NO_FONT'] },
  { name: 'no page background', css: [['background-color: #f4f4f4;', '']], expected: ['NO_LIGHT_BG'] },
  { name: 'white header background', css: [appendCss('.page-header { background-color: white; }')], expected: ['HEADER_NOT_GRAY'] },
  { name: 'black text in popular area', css: [appendCss('.popular-languages { color: black; }')], expected: ['POPULAR_NOT_WHITE'] },
  { name: 'boxes not floated', css: [['float: right;', '']], expected: ['NOT_SIDE_BY_SIDE'] },
  { name: 'flexbox instead of float', css: [['float: right;', ''], appendCss('.languages { display: flex; }')], expected: ['NO_FLOAT'], grade: 100 },
  { name: 'no box shadow', css: [[/box-shadow:[^;]*;/, '']], expected: ['BOX_NO_SHADOW'] },
  { name: 'two titles with the same color', css: [['color: dodgerblue;', 'color: red;']], expected: ['TITLES_SAME_COLOR'] },
  { name: 'floats not cleared', css: [[/\.languages::after\s*\{[^}]*\}/, ''], ['clear: both;', '']], expected: ['NOT_CLEARED'] },
];

for (const c of cases) {
  test(c.name, async ({ page }, info) => {
    const dir = info.outputPath('site');
    fs.cpSync(SOLUTION, dir, { recursive: true });
    edit(path.join(dir, 'index.html'), [...(c.headerImage === false ? [] : [HEADER_IMAGE]), ...(c.html ?? [])]);
    edit(path.join(dir, 'style.css'), c.css ?? []);
    c.setup?.(dir);

    const submission = { id: 'selftest', source: c.name, rootDir: dir, entry: c.entry ?? 'index.html' };
    const g = new Grader(info, { softAssert: false });
    const site = await openSite(page, submission, info);
    try {
      await gradeEx1(site, g);
    } finally {
      await site.close();
    }

    const result = g.result(submission);
    expect(result.flags.map((f) => f.key).sort(), explain(result)).toEqual([...c.expected].sort());
    if (!c.review) expect(result.review, explain(result)).toEqual([]);
    if (c.grade !== undefined) expect(gradeOf(result)).toBe(c.grade);
  });
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

function rename(dir: string, from: string, to: string) {
  fs.renameSync(path.join(dir, from), path.join(dir, to));
}

function moveCssIntoStyleTag(dir: string) {
  const css = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');
  fs.rmSync(path.join(dir, 'style.css'));
  edit(path.join(dir, 'index.html'), [['<link rel="stylesheet" href="style.css">', `<style>\r\n${css}\r\n</style>`]]);
}

function explain(result: StudentResult): string {
  const flags = result.flags.map((f) => `${f.key}${f.detail ? ` (${f.detail})` : ''}`);
  return `flags: ${flags.join('; ') || 'none'}\nreview: ${result.review.join('; ') || 'none'}`;
}
