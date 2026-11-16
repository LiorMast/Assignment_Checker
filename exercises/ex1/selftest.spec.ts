import type { Download } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, openSite, test } from '../../grader/fixtures';
import { Grader } from '../../grader/grader';
import ExcelJS from 'exceljs';
import { assignGroup, linkProblems, titleProblems } from '../../grader/mail-parse';
import { applyEdits, editsProblem, type GradeEdits } from '../../grader/edits';
import { DATA_SHEET, studentRows, writeWorkbook } from '../../grader/output';
import { exercises } from '../registry';
import { foreignGroups, linksFromText } from '../../grader/prepare';
import { loadRoster, rosterFromRows } from '../../grader/roster';
import { gradeOf } from '../../grader/output';
import { ROOT } from '../../grader/paths';
import { checkLivePage, checkProtocol, textSimilarity } from '../../grader/protocol';
import type { PROTOCOL_C } from '../../grader/protocol-comments';
import { serveDir } from '../../grader/server';
import type { StudentResult, SubmissionMail } from '../../grader/types';
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
  /** The exercise's comments and the shared submission-procedure ones (grader/protocol-comments.ts). */
  expected: (keyof typeof C | keyof typeof PROTOCOL_C)[];
  grade?: number;
  /** The case is expected to ask for manual review. */
  review?: boolean;
  /** The official solution has no header image; every other case adds one first. */
  headerImage?: false;
  /** A submission mail for the procedure checks (graded offline: the live page isn't opened). */
  mail?: { group: string } & SubmissionMail;
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
  { name: 'main file not named index.html', entry: 'ex1.html', setup: (dir) => rename(dir, 'index.html', 'ex1.html'), expected: ['MAIN_FILE_NAME'], grade: 98 },
  { name: 'broken stylesheet link (design still graded)', html: [['href="style.css"', 'href="css/style.css"']], expected: ['CSS_LINK_BROKEN'] },
  { name: 'CSS in a <style> tag', setup: moveCssIntoStyleTag, expected: ['NO_EXTERNAL_CSS'] },
  { name: 'image path in different case', html: [['src="images/react.png"', 'src="images/React.PNG"']], expected: ['PATH_CASE'] },
  { name: 'a few inline styles', html: [[/<p>/, '<p style="font-style: normal">'], [/<p>/, '<p style="font-style: normal">']], expected: ['INLINE_FEW'] },
  {
    name: 'extra files in the submission',
    setup: (dir) => {
      fs.writeFileSync(path.join(dir, 'LocalSend.exe'), 'MZ');
      fs.writeFileSync(path.join(dir, 'images', 'ex1_clientSide.pdf'), '%PDF');
    },
    expected: ['UNRELATED_FILES'],
    grade: 97,
  },
  {
    // cgroup66's real subject; the subject is not graded (comment 101 is retired).
    name: 'mail subject not by the procedure (not graded)',
    mail: {
      group: 'cgroup66',
      subject: 'cgroup66',
      exercise: 1,
      viewUrl: 'https://proj.ruppin.ac.il/cgroup66/test1/tar1/index.html',
      zipUrl: 'https://proj.ruppin.ac.il/cgroup66/test1/tar1/tar1.zip',
    },
    expected: [],
    grade: 100,
    review: true, // offline: the live page is not checked
  },
  { name: 'backslash in an image path', html: [['src="images/react.png"', 'src="images\\react.png"']], expected: ['PATH_BACKSLASH'] },
  { name: 'many inline styles', html: [['<p>', '<p style="font-style: normal">'], ['<h5>', '<h5 style="font-style: normal">']], expected: ['INLINE_MANY'] },

  // Structure
  { name: 'no rtl', html: [[' dir="rtl"', '']], expected: ['NO_RTL'] },
  { name: 'dir on <head> instead of <html>', html: [[' dir="rtl"', ''], ['<head>', '<head dir="rtl">']], expected: ['NO_RTL'] },
  {
    name: 'page texts in English',
    html: [
      ['<h1>שפות לפיתוח אתרים</h1>', '<h1>Web Development</h1>'],
      ['<h5>לינקים שימושיים</h5>', '<h5>Useful links</h5>'],
    ],
    expected: ['REQUIRED_TEXTS'],
  },
  { name: 'duplicate id', html: [['<div class="box">', '<div class="box" id="lang">']], expected: ['DUPLICATE_ID'] },
  { name: 'boxes with a different class name', html: [['class="box"', 'class="card"']], css: [['.box', '.card']], expected: ['CLASS_NAMES'] },
  {
    name: 'boxes written as <span>',
    html: [[/<div class="box">([\s\S]*?<\/table>\s*)<\/div>/g, '<span class="card">$1</span>']],
    css: [['.box', '.card']],
    expected: ['CLASS_NAMES'],
  },
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
  { name: 'links that go nowhere', html: [[/href="https:[^"]*"/g, 'href="#"']], expected: ['LINKS_PLACEHOLDER'], grade: 100 },
  {
    name: 'table before the useful links',
    html: [[/(<h5>לינקים שימושיים<\/h5>\s*<ul>[\s\S]*?<\/ul>)(\s*)(<table>[\s\S]*?<\/table>)/, '$3$2$1']],
    expected: ['BOX_ORDER'],
  },
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
  // A font set in the CSS counts even when it is the browser's default.
  { name: 'font set to the default Times New Roman', css: [['font-family: Calibri, Arial, sans-serif;', 'font-family: "Times New Roman";']], expected: [] },
  { name: 'no page background', css: [['background-color: #f4f4f4;', '']], expected: ['NO_LIGHT_BG'] },
  { name: 'white header background', css: [appendCss('.page-header { background-color: white; }')], expected: ['HEADER_NOT_GRAY'] },
  { name: 'black text in popular area', css: [appendCss('.popular-languages { color: black; }')], expected: ['POPULAR_NOT_WHITE'] },
  { name: 'boxes not floated', css: [['float: right;', '']], expected: ['NOT_SIDE_BY_SIDE'] },
  { name: 'flexbox instead of float', css: [['float: right;', ''], appendCss('.languages { display: flex; }')], expected: ['NO_FLOAT'], grade: 100 },
  { name: 'no box shadow', css: [[/box-shadow:[^;]*;/, '']], expected: ['BOX_NO_SHADOW'] },
  { name: 'two titles with the same color', css: [['color: dodgerblue;', 'color: red;']], expected: ['TITLES_SAME_COLOR'] },
  {
    name: 'boxes slide in with an animation (measured after it ends)',
    css: [appendCss('.box { animation: slide-in 5s both; } @keyframes slide-in { from { transform: translateY(600px); } to { transform: none; } }')],
    expected: [],
  },
  { name: 'floats not cleared', css: [[/\.languages::after\s*\{[^}]*\}/, ''], ['clear: both;', '']], expected: ['NOT_CLEARED'] },

  // Calibration on all ex1 submissions (comments table v3)
  {
    // cgroup55: floats inside a flex container are ignored; vertically centered boxes of different heights are still one row.
    name: 'floated boxes inside flex, centered, different heights',
    css: [appendCss('.languages { display: flex; align-items: center; } .box:first-child { padding-bottom: 150px; }')],
    expected: ['NO_FLOAT'],
    grade: 100,
  },
  { name: 'empty h5, title written elsewhere', html: [['<h5>לינקים שימושיים</h5>', '<h5></h5>']], expected: ['BOX_NO_H5'] }, // cgroup54
  { name: 'each link in its own ul', html: [[/<\/li>(\s*)<li>/g, '</li></ul>$1<ul><li>']], expected: ['BOX_SPLIT_LIST'] }, // cgroup61
  { name: 'table header spelled גירסאות', html: [['גרסאות מתקדמות', 'גירסאות מתקדמות']], expected: [] }, // cgroup54
  {
    // cgroup55: header row says link | version over version | link data.
    name: 'table headers swapped relative to the columns',
    html: [['<th scope="col">גרסאות מתקדמות</th>', '<th scope="col">TMP</th>'], ['<th scope="col">לינק למידע</th>', '<th scope="col">גרסאות מתקדמות</th>'], ['<th scope="col">TMP</th>', '<th scope="col">לינק למידע</th>']],
    expected: ['TABLE_COLUMNS_SWAPPED'],
  },
  { name: 'table wider than its box', css: [appendCss('.box table { width: 130%; }')], expected: ['BOX_OVERFLOW'] }, // cgroup60, cgroup68
  { name: 'tables too wide on a laptop screen only', css: [appendCss('.box table { min-width: 460px; }')], expected: ['NARROW_LAYOUT'], grade: 100 }, // cgroup66
  { name: 'gray gradient header', css: [appendCss('.page-header { background: linear-gradient(135deg, #777, #999); }')], expected: [] },
  { name: 'navy gradient header', css: [appendCss('.page-header { background: linear-gradient(135deg, #243B55, #141E30); }')], expected: ['HEADER_NOT_GRAY'] }, // cgroup50
];

for (const c of cases) {
  test(c.name, async ({ page }, info) => {
    const dir = info.outputPath('site');
    fs.cpSync(SOLUTION, dir, { recursive: true });
    edit(path.join(dir, 'index.html'), [...(c.headerImage === false ? [] : [HEADER_IMAGE]), ...(c.html ?? [])]);
    edit(path.join(dir, 'style.css'), c.css ?? []);
    c.setup?.(dir);

    const { group, ...mail } = c.mail ?? {};
    const submission = { id: 'selftest', source: c.name, rootDir: dir, entry: c.entry ?? 'index.html', ...(c.mail ? { group, mail: mail as SubmissionMail } : {}) };
    const g = new Grader(info, { softAssert: false });
    const site = await openSite(page, submission, info);
    const offline = process.env.GRADER_OFFLINE;
    if (c.mail) process.env.GRADER_OFFLINE = '1';
    try {
      await gradeEx1(site, g);
      await checkProtocol(site, g); // without a mail only the extra-files rule applies
    } finally {
      await site.close();
      if (offline === undefined) delete process.env.GRADER_OFFLINE;
      else process.env.GRADER_OFFLINE = offline;
    }

    const result = g.result(submission);
    expect(result.flags.map((f) => f.key).sort(), explain(result)).toEqual([...c.expected].sort());
    if (!c.review) expect(result.review, explain(result)).toEqual([]);
    if (c.grade !== undefined) expect(gradeOf(result)).toBe(c.grade);
  });
}

// Submission procedure: mail subject and links (real ex1 subjects), and the live-page check.
test.describe('submission procedure', () => {
  const subjects: [subject: string, group: string, ok: boolean][] = [
    ['cgroup52 tar1 ItayZonshine - 207422155, SimonPavlovski – 316226489', 'cgroup52', true],
    ['bgroup55 tar1 Lior Cohen - 211914809, Koren Abraham – 315251967', 'cgroup55', true],
    ['cgroup58 tar1 |ניב הלל-213109358 |  208084822, אייל ווהבי', 'cgroup58', true],
    ['cgroup56 tar1 Raphael Zerbib 329633622, Haim Semyonov 314839176, Ido Butbul 213177520 תיקון מייל', 'cgroup56', true],
    ['cgroup60 avichay elia - 314837857 orel toledo - 323951111', 'cgroup60', false], // no tar1
    ['cgroup67 tar1 – הגשת מטלה 1', 'cgroup67', false], // no IDs
    ['cgroup66', 'cgroup66', false],
    ['cgroup59 tar2 נור אלדין סאלח - 214025892', 'cgroup59', false], // wrong exercise
    ['cgroup51 tar1 Lior Cohen - 211914809', 'cgroup55', false], // wrong group
    ['cgroup70 tar1 211867700, 212238489', 'cgroup70', false], // IDs without names
  ];
  for (const [subject, group, ok] of subjects) {
    test(`subject ${ok ? 'ok' : 'rejected'}: ${subject}`, () => {
      expect(titleProblems(subject, group, 1).length === 0, titleProblems(subject, group, 1).join()).toBe(ok);
    });
  }

  const S = 'https://proj.ruppin.ac.il';
  const links: [name: string, group: string, view: string | undefined, zip: string | undefined, ok: boolean][] = [
    ['as in the procedure', 'cgroup52', `${S}/cgroup52/test1/tar1/index.html`, `${S}/cgroup52/test1/tar1/tar1.zip`, true],
    ['in a subfolder', 'cgroup70', `${S}/cgroup70/test1/tar1/a_b/index.html`, `${S}/cgroup70/test1/tar1/a_b/a_b.zip`, true],
    ['folder in a different case', 'cgroup57', `${S}/cgroup57/Test1/tar1/x/index.html`, `${S}/cgroup57/Test1/tar1/x/x.zip`, true],
    ['double slash', 'cgroup68', `${S}//cgroup68/test1/tar1/x/index.html`, `${S}//cgroup68/test1/tar1/x/x.zip`, false],
    ["another group's folder", 'cgroup55', `${S}/cgroup51/test1/tar1/index.html`, `${S}/cgroup51/test1/tar1/tar1.zip`, false],
    ['view link without index.html', 'cgroup64', `${S}/cgroup64/test1/tar1/x/`, `${S}/cgroup64/test1/tar1/x/x.zip`, false],
    ['spaces in the path', 'cgroup61', `${S}/cgroup61/test1/tar1/a%20b/index.html`, `${S}/cgroup61/test1/tar1/a%20b/x.zip`, false],
    ['no links', 'cgroup74', undefined, undefined, false],
    ['not on the course server', 'cgroup52', 'https://example.github.io/index.html', `${S}/cgroup52/test1/tar1/tar1.zip`, false],
  ];
  test('zip page vs live page similarity', () => {
    expect(textSimilarity('<p>a b c</p>', '<p>a  b\nc</p>')).toBe(1);
    expect(textSimilarity('<p>one two three four</p>', '<p>five six</p>')).toBeLessThan(0.5);
  });

  // A small roster in the layout of groups.xlsx (the real ex1 groups).
  const roster = rosterFromRows([
    ['שם קבוצה', 'סיסמה קבוצה', 'שם סטודנט 1', 'ת.ז. סטודנט 1', 'איימל סטודנט 1', 'שם סטודנט 2', 'ת.ז. סטודנט 2', 'איימל סטודנט 2'],
    ['cgroup51', 'secret', 'ליאור כהן', '211914809', 'lior880721@gmail.com', 'קורן אברהם', '315251967', 'abrahamkoren46@gmail.com'],
    ['cgroup55', 'secret', 'נעם אברמוביץ', '207417445', 'Noam1998@gmail.com', 'יובל ירון', '324950369', 'yaron.yuval@protonmail.com'],
    ['cgroup62', 'secret', 'רואן מסארווה', '213757685', 'rmasarwe99@gmail.com', 'מועתסם מחאגנה', '325985091', 'x@gmail.com'],
    ['cgroup65', 'secret', 'גיא כהן', '301198099', 'nhbh87@gmail.com', '', '', ''],
    ['cgroup66', 'secret', 'יוסף עאזם', '214474280', 'a@gmail.com', 'אחמד רעד', '314708256', 'ahmadraed719@gmail.com'],
    ['cgroup69', 'secret', '', '', '', '', '', ''],
    ['cgroup74', 'secret', 'עומר צפריר', '318254471', 'omerzafrir97@gmail.com', 'סיון ברוך', '326272341', 'sivan.baruch200@gmail.com'],
  ]);

  test('roster: columns by header, empty groups skipped, no password', () => {
    expect([...roster.groups.keys()]).toEqual(['cgroup51', 'cgroup55', 'cgroup62', 'cgroup65', 'cgroup66', 'cgroup74']);
    expect(roster.groups.get('cgroup74')!.map((s) => s.id)).toEqual(['318254471', '326272341']);
    expect(roster.byEmail.get('noam1998@gmail.com')).toBe('cgroup55');
    expect(JSON.stringify([...roster.groups.values()])).not.toContain('secret');
  });

  test('roster: read from an xlsx whose table has a filter', async ({}, info) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addTable({
      name: 'groups',
      ref: 'A1',
      headerRow: true,
      columns: ['שם קבוצה', 'סיסמה קבוצה', 'שם סטודנט 1', 'ת.ז. סטודנט 1', 'איימל סטודנט 1'].map((name) => ({ name, filterButton: true })),
      rows: [['cgroup65', 'secret', 'גיא כהן', '301198099', 'NHBH87@gmail.com']],
    });
    const file = info.outputPath('groups.xlsx');
    await workbook.xlsx.writeFile(file);
    const read = await loadRoster(file);
    expect(read?.groups.get('cgroup65')).toEqual([{ name: 'גיא כהן', id: '301198099', email: 'nhbh87@gmail.com' }]);
  });

  // The group folder in the zip link decides first, then the roster (sender, IDs), then the subject.
  const mail = (subject: string, fromAddress: string, folder?: string, ids: string[] = []) => ({
    subject,
    fromAddress,
    ids,
    ...(folder ? { viewUrl: `${S}/${folder}/test1/tar1/x/index.html`, zipUrl: `${S}/${folder}/test1/tar1/x/x.zip` } : {}),
  });
  const groupCases: [name: string, m: ReturnType<typeof mail>, group: string | undefined, by: string | undefined][] = [
    ['subject bgroup55, links in cgroup51 → cgroup51 (by link)', mail('bgroup55 tar1 Lior Cohen - 211914809', 'abrahamkoren46@gmail.com', 'cgroup51', ['211914809']), 'cgroup51', 'link'],
    ['zip in a bgroup55 folder → cgroup55', mail('tar1', 'someone@gmail.com', 'bgroup55'), 'cgroup55', 'link'],
    ['subject bgroup62, links in cgroup62', mail('bgroup62 tar1 rawan_masarwe-213757685', 'rmasarwe99@gmail.com', 'cgroup62', ['213757685']), 'cgroup62', 'link'],
    ['only the group in the subject', mail('cgroup66', 'ahmadraed719@gmail.com', 'cgroup66'), 'cgroup66', 'link'],
    ['no links (ftp): the sender', mail('cgroup74 tar1 Omer Zafrir - 318254471', 'omerzafrir97@gmail.com', undefined, ['318254471']), 'cgroup74', 'sender'],
    ['unknown sender: the IDs', mail('tar1 211914809', 'other@gmail.com', undefined, ['211914809']), 'cgroup51', 'ids'],
    ['nothing but the subject', mail('cgroup65 tar1', 'other@gmail.com'), 'cgroup65', 'subject'],
    ['nothing at all', mail('מטלה 1', 'other@gmail.com'), undefined, undefined],
  ];
  for (const [name, m, group, by] of groupCases) {
    test(`mail group: ${name}`, () => {
      const assigned = assignGroup(m, roster);
      expect([assigned.group, assigned.by]).toEqual([group, by]);
    });
  }
  test('mail group: the link wins over the subject, and the disagreement is noted', () => {
    const assigned = assignGroup(mail('bgroup55 tar1', 'other@gmail.com', 'cgroup51'), roster);
    expect(assigned.group).toBe('cgroup51');
    expect(assigned.conflicts.join()).toContain('cgroup55');
  });
  test('mail group: a hand assignment (mail-groups.json) wins', () => {
    const byHand = new Map([['abrahamkoren46@gmail.com', 'cgroup55']]);
    expect(assignGroup(mail('x', 'abrahamkoren46@gmail.com', 'cgroup51'), roster, byHand)).toMatchObject({ group: 'cgroup55', by: 'by-hand' });
  });

  // cgroup65 submitted without a mail: the links are given in manual-submissions/ex1/cgroup65/links.txt.
  test('links.txt of a submission without a mail', () => {
    const links = linksFromText(
      'Submitted separately\nProj.ruppin.ac.il/cgroup65/test1/tar1/301198099/index.html\nProj.ruppin.ac.il/cgroup65/test1/tar1/301198099/301198099.zip\n',
    );
    expect(links.viewUrl).toMatch(/\/cgroup65\/test1\/tar1\/301198099\/index\.html$/i);
    expect(links.zipUrl).toMatch(/\/301198099\.zip$/);
    expect(linkProblems({ group: 'cgroup65', exercise: 1, ...links })).toEqual([]);
  });

  test("zip names with another group's IDs", () => {
    expect(foreignGroups(['211914809_315251967.zip', '211914809_315251967'], 'cgroup65', roster)).toEqual(['cgroup51']);
    expect(foreignGroups(['211914809_315251967.zip'], 'cgroup51', roster)).toEqual([]);
    expect(foreignGroups(['314708257 & 214474280'], 'cgroup66', roster)).toEqual([]); // a typo in one ID is ignored
  });

  test('students report: every roster student, 0 for no submission', () => {
    const result = (group: string, students: string[], graded = true) =>
      ({ id: group, source: '', group, students, graded, flags: [{ key: 'X', no: 14, text: '', points: 10 }], review: [] }) as StudentResult;
    const rows = studentRows([result('cgroup74', ['318254471', '326272341']), result('cgroup55', [], false), result('cgroup99', ['123456789'])], roster);
    const of = (id: string) => rows.find((r) => r.id === id)!;
    expect(of('326272341')).toMatchObject({ group: 'cgroup74', name: 'סיון ברוך', grade: 90, status: 'נבדק', comments: '14' });
    expect(of('301198099')).toMatchObject({ group: 'cgroup65', grade: 0, status: 'לא הוגש' });
    expect(of('207417445')).toMatchObject({ grade: null, status: 'לבדיקה ידנית' });
    expect(of('123456789')).toMatchObject({ group: 'cgroup99', grade: 90 }); // not in the roster: kept at the end
    expect(rows.filter((r) => r.group === 'cgroup51').every((r) => r.status === 'לא הוגש')).toBe(true);
  });

  for (const [name, group, viewUrl, zipUrl, ok] of links) {
    test(`links ${ok ? 'ok' : 'rejected'}: ${name}`, () => {
      const problems = linkProblems({ group, exercise: 1, viewUrl, zipUrl });
      expect(problems.length === 0, problems.join()).toBe(ok);
    });
  }

  test('live page: missing stylesheet, wrong address, server down', async ({ page }, info) => {
    const dir = info.outputPath('live');
    fs.cpSync(SOLUTION, dir, { recursive: true });
    fs.rmSync(path.join(dir, 'style.css'));
    const server = await serveDir(dir);
    try {
      const missing = await checkLivePage(page, `${server.url}/index.html`, '127.0.0.1');
      expect(missing).toMatchObject({ status: 'ok', failed: ['style.css'] });
      expect(textSimilarity((missing as { html: string }).html, fs.readFileSync(path.join(dir, 'index.html'), 'utf8'))).toBe(1);
      expect((await checkLivePage(page, `${server.url}/nope/index.html`, '127.0.0.1')).status).toBe('not-open');
    } finally {
      await server.close();
    }
    expect((await checkLivePage(page, 'http://127.0.0.1:9/index.html', '127.0.0.1')).status).toBe('unreachable');
  });
});

// The grader's hand edits: grader/edits.ts, and grades-viewer.html, which must apply them the same way.
test.describe('hand edits (grade-edits.json)', () => {
  const ex = exercises.ex1;
  const comments = ex.comments;
  const no = (key: keyof typeof C) => C[key].no;
  const flag = (key: keyof typeof C, points?: number, detail?: string) =>
    ({ key, no: C[key].no, text: C[key].text, points: points ?? C[key].points, ...(detail ? { detail } : {}) }) as StudentResult['flags'][number];
  const results: StudentResult[] = [
    { id: '111111118', group: 'cgroup01', students: ['111111118', '222222226'], graded: true, flags: [flag('NO_HEADER'), flag('BOX_NO_LIST', 3, 'קופסת CSS'), flag('FEW_BOXES', 6, 'חסרות 2')], review: [] },
    { id: 'cgroup02', group: 'cgroup02', students: ['333333334'], graded: false, flags: [flag('NO_RTL')], review: ['הבדיקה האוטומטית לא הושלמה: timeout'] },
    { id: '444444442', graded: true, flags: [], review: ['נראה כמו פתרון של השנה שעברה'] },
  ];
  const snapshot = JSON.stringify(results);

  test('applyEdits: comments, grades and review', () => {
    const edits: GradeEdits = {
      version: 1,
      comments: { [no('NO_HEADER')]: { points: 4 }, [no('FEW_BOXES')]: { points: 9 }, [no('NO_RTL')]: { text: 'נוסח חדש' }, 201: { text: 'הערה ידנית', points: 3 } },
      groups: {
        cgroup01: { flags: { [no('BOX_NO_LIST')]: null, [no('FEW_BOXES')]: { points: 3, detail: 'חסרה 1' }, 201: {} } },
        cgroup02: { graded: true, notes: ['לבדוק שוב'] },
        '444444442': { grade: 90, dismissed: ['נראה כמו פתרון של השנה שעברה'] },
        cgroup99: { grade: 50 },
        cgroup03: { checked: true },
      },
    };
    const { results: out, comments: table, warnings } = applyEdits(results, comments, edits);
    const [g1, g2, solo] = out;
    // A table-wide points change applies where the group has no own value; per-unit comments keep their points.
    expect(g1.flags.map((f) => [f.no, f.points, f.detail])).toEqual([[no('NO_HEADER'), 4, undefined], [no('FEW_BOXES'), 3, 'חסרה 1'], [201, 3, undefined]]);
    expect([gradeOf(g1), g1.edited]).toEqual([90, true]);
    expect(g2.flags[0].text).toBe('נוסח חדש');
    expect([g2.graded, gradeOf(g2), g2.review]).toEqual([true, 100 - C.NO_RTL.points, ['הבדיקה האוטומטית לא הושלמה: timeout', 'לבדוק שוב']]);
    expect([solo.review, gradeOf(solo), solo.manualGrade]).toEqual([[], 90, 90]);
    expect(table.MANUAL_201).toMatchObject({ no: 201, text: 'הערה ידנית', points: 3 });
    expect([table.NO_HEADER.points, table.FEW_BOXES.points, table.NO_RTL.text]).toEqual([4, C.FEW_BOXES.points, 'נוסח חדש']);
    expect([g1.checked, solo.checked]).toEqual([undefined, undefined]);
    expect(applyEdits(results, comments, { version: 1, groups: { '444444442': { checked: true } } }).results[2]).toMatchObject({ checked: true, review: results[2].review });
    expect(applyEdits(results, comments, { version: 1, groups: { '444444442': { checked: true } } }).results[2].edited).toBeUndefined(); // a status, not an edit
    expect(warnings.join('\n')).toMatch(/cgroup99[\s\S]*per unit|per unit[\s\S]*cgroup99/);
    expect(JSON.stringify(results)).toBe(snapshot); // the automatic results are not changed
  });

  test('applyEdits: without edits the results are kept as they are', () => {
    expect(applyEdits(results, comments).results).toBe(results);
    expect(applyEdits(results, comments, { version: 1 }).results.map(gradeOf)).toEqual(results.map(gradeOf));
  });

  test('edits file validation', () => {
    expect(editsProblem({ version: 1 })).toBeUndefined();
    expect(editsProblem({ version: 2 })).toMatch(/version/);
    expect(editsProblem({ version: 1, groups: { cgroup01: { grade: 120 } } })).toMatch(/grade/);
    expect(editsProblem({ version: 1, groups: { cgroup01: { flags: { 43: { points: -1 } } } } })).toMatch(/points/);
    expect(editsProblem({ version: 1, comments: { abc: { text: 'x' } } })).toMatch(/comment number/);
  });

  test('grades-viewer.html: edits made in the page match the pipeline', async ({ page }, info) => {
    const file = info.outputPath('grades.xlsx');
    await writeWorkbook(file, ex, results);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('dialog', (d) => d.accept());
    await page.goto(pathToFileURL(path.join(ROOT, 'grades-viewer.html')).href);
    await page.setInputFiles('#file', file);
    const item = (name: string) => page.locator('.item').filter({ has: page.locator('.name', { hasText: name }) });
    const field = (name: string, k: string) => item(name).locator(`[data-k="${k}"]`);
    const change = async (name: string, k: string, value: string) => {
      await field(name, k).fill(value);
      await field(name, k).press('Tab');
    };

    await item('cgroup01').locator('.head').click();
    await change('cgroup01', `pts-${no('NO_HEADER')}`, '4');
    await change('cgroup01', `detail-${no('FEW_BOXES')}`, 'חסרה 1');
    await field('cgroup01', `toggle-${no('BOX_NO_LIST')}`).click();
    await field('cgroup01', 'add').fill(String(no('NO_RTL')));
    await field('cgroup01', 'add').press('Enter');
    await expect(field('cgroup01', `pts-${no('NO_RTL')}`)).toBeVisible();

    // Only one row is open at a time; "checked and next" opens the next unchecked group.
    await field('cgroup01', 'check-next').click();
    await expect(item('cgroup01')).not.toHaveClass(/open/);
    await expect(item('cgroup02')).toHaveClass(/open/);
    await expect(field('cgroup01', 'check')).toHaveAttribute('aria-pressed', 'true');
    await item('cgroup02').locator('.head').click();
    await item('cgroup02').locator('.head').click();
    await field('cgroup02', 'rv-0').click();
    await field('cgroup02', 'graded').click();
    await field('cgroup02', 'note').fill('לבדוק שוב');
    await field('cgroup02', 'note').press('Enter');
    await expect(item('cgroup02').getByText('לבדוק שוב')).toBeVisible();

    await item('444444442').locator('.head').click();
    await expect(page.locator('.item.open')).toHaveCount(1);
    await change('444444442', 'grade', '95');

    await page.click('#open-pool');
    await page.fill('#pool-new-text', 'הערה ידנית');
    await page.fill('#pool-new-points', '3');
    await page.click('#pool-add button[type=submit]');
    await page.locator(`#pool [data-k="cp-${no('NO_HEADER')}"]`).fill('6');
    await page.locator(`#pool [data-k="cp-${no('NO_HEADER')}"]`).press('Tab');
    await page.locator(`#pool [data-k="ct-${no('NO_RTL')}"]`).fill('נוסח חדש');
    await page.locator(`#pool [data-k="ct-${no('NO_RTL')}"]`).press('Tab');
    // Sorting the comments table: by number descending puts the new comment (201) first; by use, a used one.
    await page.click('#pool th[data-sort=no] button');
    await expect(page.locator('#pool-rows .c-no').first()).toHaveText('201');
    await page.click('#pool th[data-sort=uses] button');
    await expect(page.locator('#pool th[data-sort=uses]')).toHaveAttribute('aria-sort', 'descending');
    await expect(page.locator('#pool-rows .uses').first()).toContainText('קבוצ');
    await page.click('#pool-close');
    await field('444444442', 'add').fill('201');
    await field('444444442', 'add').press('Enter');
    await expect(field('444444442', 'pts-201')).toBeVisible();

    // Undo and redo the last step.
    await page.click('#undo');
    await expect(field('444444442', 'pts-201')).toHaveCount(0);
    await page.click('#redo');
    await expect(field('444444442', 'pts-201')).toBeVisible();

    const downloads: Download[] = [];
    page.on('download', (d) => downloads.push(d));
    // הורדה downloads the updated grades.xlsx in one click (grade-edits.json is only written by שמירה).
    await page.click('#download');
    await expect.poll(() => downloads.length).toBe(1);
    expect(downloads[0].suggestedFilename()).toBe('grades.xlsx');
    const saved = new Map<string, string>();
    const to = info.outputPath('saved-grades.xlsx');
    await downloads[0].saveAs(to);
    saved.set('grades.xlsx', to);
    const edits = JSON.parse(
      // @ts-expect-error: the page's own global
      await page.evaluate(() => editsJson()),
    ) as GradeEdits;
    expect(editsProblem(edits)).toBeUndefined();
    expect(edits.groups?.cgroup01?.flags).toEqual({ [no('NO_HEADER')]: { points: 4 }, [no('FEW_BOXES')]: { detail: 'חסרה 1' }, [no('BOX_NO_LIST')]: null, [no('NO_RTL')]: {} });
    expect(edits.groups?.cgroup01?.checked).toBe(true);
    expect(edits.comments).toEqual({ [no('NO_HEADER')]: { points: 6 }, [no('NO_RTL')]: { text: 'נוסח חדש' }, 201: { text: 'הערה ידנית', points: 3 } });

    // The page shows what the pipeline computes from the saved file.
    const applied = applyEdits(results, comments, edits);
    const expected = applied.results.map((r) => [r.group ?? r.id, gradeOf(r) ?? null, r.flags.map((f) => [f.no, f.points, f.text, f.detail ?? null]), r.review]);
    const shown = await page.evaluate(() =>
      // @ts-expect-error: the page's own global
      (state.view.groups as any[]).map((g) => [g.name, g.grade, g.r.flags.map((f: any) => [f.no, f.points, f.text, f.detail ?? null]), g.r.review]),
    );
    expect(shown).toEqual(expected);
    expect(expected.map((e) => e[1])).toEqual([100 - 4 - 6 - C.NO_RTL.points, 100 - C.NO_RTL.points, 95]);

    // The page's grades.xlsx has the same visible sheets as the pipeline's with the same edits.
    const pipelineFile = info.outputPath('pipeline.xlsx');
    await writeWorkbook(pipelineFile, ex, results, edits);
    const sheetValues = async (f: string) => {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(f);
      return workbook.worksheets.map((s) => {
        const rows: unknown[][] = [];
        s.eachRow((row, n) => (rows[n] = (row.values as unknown[]).map((v) => v ?? null)));
        return { name: s.name, state: s.state, rows: s.name === DATA_SHEET ? [] : rows };
      });
    };
    expect(await sheetValues(saved.get('grades.xlsx')!)).toEqual(await sheetValues(pipelineFile));

    // Importing the saved file brings back the same edits, with a fresh undo history.
    await page.setInputFiles('#file', saved.get('grades.xlsx')!);
    await page.setInputFiles('#file', pipelineFile);
    const reopened = await page.evaluate(() => {
      // @ts-expect-error: the page's own globals
      return [JSON.parse(editsJson()), state.undo.length, (state.view.groups as any[]).filter((g) => g.edited).length];
    });
    expect(reopened).toEqual([edits, 0, 3]);
    expect(errors).toEqual([]);
  });
});

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
