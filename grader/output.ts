import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import type { ExerciseInfo } from '../exercises/registry';
import { pointsLabel } from './comments';
import type { StudentResult } from './types';

/** 100 minus the deductions; undefined when the submission could not be graded automatically. */
export function gradeOf(result: StudentResult): number | undefined {
  if (!result.graded) return undefined;
  return Math.max(0, 100 - result.flags.reduce((sum, f) => sum + f.points, 0));
}

/** Writes results.json, grades.xlsx, feedback/<id>.txt and summary.html into `dir`. */
export async function writeOutputs(dir: string, exercise: ExerciseInfo, results: StudentResult[]) {
  fs.mkdirSync(path.join(dir, 'feedback'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
  for (const r of results) fs.writeFileSync(path.join(dir, 'feedback', `${r.id}.txt`), feedback(exercise, r));
  await writeWorkbook(path.join(dir, 'grades.xlsx'), exercise, results);
  fs.writeFileSync(path.join(dir, 'summary.html'), summaryHtml(exercise, results));
}

/** Keeps IDs numeric like in the course workbook, unless that would drop a leading zero. */
const idCell = (id: string) => (/^[1-9]\d*$/.test(id) ? Number(id) : id);

interface GradeRow {
  id: string;
  group?: string;
  review: string[];
}

/** grades.xlsx rows of a result: one per student of a group (a group without IDs keeps one row under its name). */
function gradeRows(r: StudentResult): GradeRow[] {
  if (!r.group) return [{ id: r.id, review: r.review }];
  if (!r.students?.length) return [{ id: r.group, group: r.group, review: r.review }];
  return r.students.map((id) => ({ id, group: r.group, review: r.review }));
}

/** Same layout as the course's grades workbook: students in A–D, comments table in G–I. */
async function writeWorkbook(file: string, exercise: ExerciseInfo, results: StudentResult[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(exercise.sheetName, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 2 }] });
  const hasGroups = results.some((r) => r.group);
  sheet.columns = [14, 12, 30, 50, hasGroups ? 11 : 4, 4, 11, 95, 18].map((width) => ({ width }));
  sheet.mergeCells('A1:C1');
  sheet.getCell('A1').value = exercise.title;
  sheet.mergeCells('G1:I1');
  sheet.getCell('G1').value = 'טבלת הערות';
  const headers: [string, string][] = [
    ['A2', 'זהות'],
    ['B2', exercise.gradeHeader],
    ['C2', 'מספרי הערות  (מתוך טבלת הערות בצד שמאל)'],
    ['D2', 'לבדיקה ידנית'],
    ...(hasGroups ? ([['E2', 'קבוצה']] as [string, string][]) : []),
    ['G2', 'מספר הערה'],
    ['H2', 'תוכן הערה'],
    ['I2', 'ניקוד להפחתה'],
  ];
  for (const [cell, text] of headers) sheet.getCell(cell).value = text;
  sheet.getRow(1).font = { bold: true, size: 12 };
  sheet.getRow(2).font = { bold: true };

  const rows = results.flatMap((r) => gradeRows(r).map((g) => ({ r, g })));
  rows.forEach(({ r, g }, i) => {
    const row = sheet.getRow(3 + i);
    const numbers = r.flags.map((f) => f.no);
    row.getCell(1).value = idCell(g.id);
    row.getCell(2).value = gradeOf(r) ?? null;
    row.getCell(3).value = numbers.length === 1 ? numbers[0] : numbers.join(',') || null;
    row.getCell(4).value = g.review.join('; ') || null;
    row.getCell(4).alignment = { wrapText: true, vertical: 'top' };
    if (g.group) row.getCell(5).value = g.group;
  });
  Object.values(exercise.comments).forEach((c, i) => {
    const row = sheet.getRow(3 + i);
    row.getCell(7).value = c.no;
    row.getCell(8).value = c.text;
    row.getCell(9).value = pointsLabel(c);
  });

  const details = workbook.addWorksheet('פירוט', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  details.columns = [
    { header: 'זהות', width: 14 },
    { header: 'מספר הערה', width: 11 },
    { header: 'תוכן הערה', width: 70 },
    { header: 'ניקוד להפחתה', width: 13 },
    { header: 'פירוט', width: 90 },
    ...(hasGroups ? [{ header: 'קבוצה', width: 11 }] : []),
  ];
  details.getRow(1).font = { bold: true };
  for (const { r, g } of rows) {
    const group = g.group ? [g.group] : [];
    for (const f of r.flags) details.addRow([idCell(g.id), f.no, f.text, f.points, f.detail ?? '', ...group]);
    for (const reason of g.review) details.addRow([idCell(g.id), null, 'לבדיקה ידנית', null, reason, ...group]);
  }
  await workbook.xlsx.writeFile(file);
}

/** Feedback text for the student. Manual-review reasons are for the grader and are left out. */
function feedback(exercise: ExerciseInfo, r: StudentResult): string {
  const grade = gradeOf(r);
  const who = r.group ? [`קבוצה: ${r.group}`, `ת"ז: ${r.students?.join(', ') || '–'}`] : [`ת"ז: ${r.id}`];
  const lines = [exercise.title, ...who, `ציון: ${grade ?? 'ייקבע לאחר בדיקה ידנית'}`, ''];
  if (r.flags.length) {
    lines.push('הערות:');
    for (const f of r.flags) {
      const points = f.points ? `הורדה של ${f.points} נק'` : f.text.includes('לא ירדו נקודות') ? '' : 'ללא הורדת נקודות';
      lines.push(`• (${f.no}) ${f.text}${points ? ` – ${points}` : ''}`);
      if (f.detail) lines.push(`    פירוט: ${f.detail}`);
    }
  } else if (grade !== undefined) {
    lines.push('לא נמצאו הערות – כל הכבוד!');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** One card per student (screenshot, grade, comments) for a fast visual check of the auto-grade. */
function summaryHtml(exercise: ExerciseInfo, results: StudentResult[]): string {
  const grades = results.map(gradeOf).filter((g): g is number => g !== undefined);
  const average = grades.length ? (grades.reduce((a, b) => a + b, 0) / grades.length).toFixed(1) : '–';
  const reviewCount = results.filter((r) => r.review.length).length;
  const cards = results.map((r) => {
    const grade = gradeOf(r);
    const shot = r.screenshot
      ? `<a href="screenshots/${encodeURIComponent(r.screenshot)}" target="_blank"><img src="screenshots/${encodeURIComponent(r.screenshot)}" alt="צילום מסך" loading="lazy"></a>`
      : '<div class="no-shot">אין צילום מסך</div>';
    const flags = r.flags
      .map(
        (f) =>
          `<li class="${f.points ? 'deduct' : 'note'}"><span class="no">${f.no}</span><span class="text">${escapeHtml(f.text)}` +
          `${f.detail ? `<small>${escapeHtml(f.detail)}</small>` : ''}</span><span class="pts">${f.points ? `−${f.points}` : '0'}</span></li>`,
      )
      .join('');
    const review = r.review.map((reason) => `<p class="review">לבדיקה ידנית: ${escapeHtml(reason)}</p>`).join('');
    return `<article class="card${r.review.length ? ' needs-review' : ''}">
  ${shot}
  <div class="body">
    <header><h2>${escapeHtml(r.id)}${r.students?.length ? `<small>${r.students.map(escapeHtml).join(', ')}</small>` : ''}</h2><span class="grade">${grade ?? '–'}</span></header>
    ${review}
    ${flags ? `<ul>${flags}</ul>` : grade === undefined ? '' : '<p class="ok">ללא הערות</p>'}
    <a class="feedback" href="feedback/${encodeURIComponent(r.id)}.txt">משוב לסטודנט</a>
  </div>
</article>`;
  });

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(exercise.title)} – סיכום</title>
<style>
  :root { --bg: #f5f5f4; --card: #fff; --text: #1c1917; --muted: #78716c; --line: #e7e5e4; --bad: #b91c1c; --warn: #b45309; --good: #15803d; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; font-family: system-ui, "Segoe UI", Arial, sans-serif; background: var(--bg); color: var(--text); }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .stats { margin: 0 0 20px; color: var(--muted); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; }
  .card.needs-review { border-color: var(--warn); box-shadow: 0 0 0 2px #fde68a; }
  .card img, .no-shot { display: block; width: 100%; height: 190px; object-fit: cover; object-position: top; border-bottom: 1px solid var(--line); }
  .no-shot { display: grid; place-items: center; color: var(--muted); }
  .body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
  header { display: flex; justify-content: space-between; align-items: baseline; }
  h2 { margin: 0; font-size: 17px; font-variant-numeric: tabular-nums; }
  .grade { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  li { display: grid; grid-template-columns: 28px 1fr auto; gap: 8px; font-size: 14px; line-height: 1.4; }
  .no { color: var(--muted); font-variant-numeric: tabular-nums; }
  .pts { font-weight: 600; white-space: nowrap; }
  li.deduct .pts { color: var(--bad); }
  li.note { color: var(--muted); }
  small { display: block; color: var(--muted); font-size: 12px; word-break: break-word; }
  .review { margin: 0; color: var(--warn); font-size: 14px; }
  .ok { margin: 0; color: var(--good); }
  .feedback { margin-top: auto; font-size: 13px; color: #1d4ed8; }
</style>
</head>
<body>
<h1>${escapeHtml(exercise.title)}</h1>
<p class="stats">${results.length} הגשות${results.some((r) => r.group) ? ` (${results.reduce((n, r) => n + (r.students?.length || 1), 0)} סטודנטים)` : ''} · ממוצע ${average} · ${reviewCount} לבדיקה ידנית</p>
<main class="grid">
${cards.join('\n')}
</main>
</body>
</html>
`;
}
