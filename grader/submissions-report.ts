import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { formatIsraelTime } from './mail-parse';
import { escapeHtml } from './output';
import type { GroupRecord } from './types';

/** A cgroup mail with no exercise number in its subject or links (not downloaded). */
export interface UnclassifiedMail {
  group: string;
  date: string;
  subject: string;
  from: string;
}

const ZIP_STATUS: Record<NonNullable<GroupRecord['zipSource']>, string> = {
  link: 'הורד מהלינק',
  attachment: 'נלקח מהקובץ המצורף',
  previous: 'מהרצה קודמת',
};
const zipStatus = (r: GroupRecord) => (r.zipSource ? ZIP_STATUS[r.zipSource] : `לא הורד: ${r.error}`);

const multipleNote = (r: GroupRecord) =>
  r.earlier.length
    ? `הוגש ${r.earlier.length + 1} פעמים – נלקחה ההגשה האחרונה; קודמות: ${r.earlier.map((e) => formatIsraelTime(e.date)).join(', ')}`
    : '';

/** Writes submissions.html and submissions.xlsx into `dir`; returns their paths. */
export async function writeSubmissionsReport(
  dir: string,
  exercise: string,
  records: GroupRecord[],
  unclassified: UnclassifiedMail[],
  deadline?: Date,
): Promise<string[]> {
  fs.mkdirSync(dir, { recursive: true });
  const html = path.join(dir, 'submissions.html');
  const xlsx = path.join(dir, 'submissions.xlsx');
  fs.writeFileSync(html, reportHtml(exercise, records, unclassified, deadline));
  await reportWorkbook(xlsx, records, unclassified, deadline);
  return [html, xlsx];
}

async function reportWorkbook(file: string, records: GroupRecord[], unclassified: UnclassifiedMail[], deadline?: Date) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('הגשות', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'קבוצה', width: 11 },
    { header: 'ת"ז', width: 22 },
    { header: 'מועד הגשה', width: 18 },
    ...(deadline ? [{ header: 'באיחור', width: 8 }] : []),
    { header: 'לינק לצפייה', width: 45 },
    { header: 'לינק ל-zip', width: 45 },
    { header: 'קובץ zip', width: 30 },
    { header: 'הגשות מרובות', width: 45 },
    { header: 'לא לפי הנוהל', width: 70 },
    { header: 'נושא המייל', width: 50 },
    { header: 'שולח', width: 35 },
  ];
  sheet.getRow(1).font = { bold: true };
  const link = (url?: string) => (url ? { text: url, hyperlink: url } : null);
  for (const r of records) {
    const row = sheet.addRow([
      r.group,
      r.students.join(', ') || null,
      formatIsraelTime(r.submittedAt),
      ...(deadline ? [r.late ? 'כן' : ''] : []),
      link(r.viewUrl),
      link(r.zipUrl),
      zipStatus(r),
      multipleNote(r) || null,
      r.violations.join('\n') || null,
      r.subject,
      r.from,
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
    const color = !r.zipSource ? 'FFFECACA' : r.violations.length ? 'FFFEE2E2' : r.earlier.length ? 'FFFEF3C7' : undefined;
    if (color) row.eachCell((cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }));
  }
  if (unclassified.length) {
    const other = workbook.addWorksheet('ללא מספר תרגיל', { views: [{ rightToLeft: true }] });
    other.columns = [
      { header: 'קבוצה', width: 11 },
      { header: 'תאריך', width: 18 },
      { header: 'נושא המייל', width: 60 },
      { header: 'שולח', width: 35 },
    ];
    other.getRow(1).font = { bold: true };
    for (const m of unclassified) other.addRow([m.group, formatIsraelTime(m.date), m.subject, m.from]);
  }
  await workbook.xlsx.writeFile(file);
}

function reportHtml(exercise: string, records: GroupRecord[], unclassified: UnclassifiedMail[], deadline?: Date): string {
  const e = escapeHtml;
  const a = (url?: string, label?: string) => (url ? `<a href="${e(url)}" target="_blank" rel="noreferrer">${e(label ?? url)}</a>` : '<span class="missing">חסר</span>');
  const ids = (r: GroupRecord) => (r.students.length ? r.students.map(e).join('<br>') : '<span class="missing">חסר</span>');

  const noZip = records.filter((r) => !r.zipSource);
  const broken = records.filter((r) => r.violations.length);
  const multiple = records.filter((r) => r.earlier.length);
  const noIds = records.filter((r) => !r.students.length);

  const rows = records
    .map((r) => {
      const cls = [!r.zipSource && 'no-zip', r.violations.length && 'violation', r.earlier.length && 'multiple'].filter(Boolean).join(' ');
      return `<tr class="${cls}">
  <td class="group">${e(r.group)}</td>
  <td class="num">${ids(r)}</td>
  <td class="num">${e(formatIsraelTime(r.submittedAt))}${r.late ? ' <span class="tag late">באיחור</span>' : ''}</td>
  <td class="link">${a(r.viewUrl, 'צפייה')}</td>
  <td class="link">${a(r.zipUrl, 'zip')}</td>
  <td>${r.zipSource ? e(zipStatus(r)) : `<span class="bad">${e(zipStatus(r))}</span>`}</td>
  <td>${r.earlier.length ? `<span class="tag multi">${r.earlier.length + 1} הגשות</span>` : ''}</td>
  <td>${r.violations.length ? `<ul>${r.violations.map((v) => `<li>${e(v)}</li>`).join('')}</ul>` : '<span class="ok">✓</span>'}</td>
  <td class="subject" title="${e(r.from)}">${e(r.subject)}</td>
</tr>`;
    })
    .join('\n');

  const section = (title: string, items: string[], note = '') =>
    items.length ? `<section><h2>${e(title)} <span class="count">${items.length}</span></h2>${note}<ul class="list">${items.join('')}</ul></section>` : '';
  const who = (r: GroupRecord) => `<b>${e(r.group)}</b>${r.students.length ? ` <span class="muted">(${r.students.map(e).join(', ')})</span>` : ''}`;

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>הגשות ${e(exercise)}</title>
<style>
  :root { --bg: #f5f5f4; --card: #fff; --text: #1c1917; --muted: #78716c; --line: #e7e5e4; --bad: #b91c1c; --bad-bg: #fef2f2; --warn: #b45309; --warn-bg: #fffbeb; --good: #15803d; --link: #1d4ed8; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #1c1917; --card: #292524; --text: #f5f5f4; --muted: #a8a29e; --line: #44403c; --bad: #f87171; --bad-bg: #3b1d1d; --warn: #fbbf24; --warn-bg: #3a2e12; --good: #4ade80; --link: #93c5fd; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; font-family: system-ui, "Segoe UI", Arial, sans-serif; background: var(--bg); color: var(--text); font-size: 14px; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  h2 { font-size: 16px; margin: 0 0 8px; }
  a { color: var(--link); }
  .stats { margin: 0 0 20px; color: var(--muted); }
  .sections { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin-bottom: 20px; }
  section { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
  .count { color: var(--muted); font-weight: 400; }
  .list { margin: 0; padding: 0 18px 0 0; display: flex; flex-direction: column; gap: 6px; }
  .wrap { overflow-x: auto; background: var(--card); border: 1px solid var(--line); border-radius: 10px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: start; vertical-align: top; }
  th { position: sticky; top: 0; background: var(--card); font-weight: 600; white-space: nowrap; }
  td ul { margin: 0; padding: 0 16px 0 0; }
  tr.violation td { background: var(--bad-bg); }
  tr.multiple:not(.violation) td { background: var(--warn-bg); }
  .group { font-weight: 600; white-space: nowrap; }
  .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .link { white-space: nowrap; }
  .subject { color: var(--muted); max-width: 360px; }
  .muted { color: var(--muted); }
  .missing, .bad { color: var(--bad); font-weight: 600; }
  .ok { color: var(--good); }
  .tag { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .tag.multi { background: var(--warn-bg); color: var(--warn); border: 1px solid var(--warn); }
  .tag.late { background: var(--bad-bg); color: var(--bad); border: 1px solid var(--bad); }
</style>
</head>
<body>
<h1>הגשות ${e(exercise)}</h1>
<p class="stats">${records.length} קבוצות הגישו · ${noZip.length} ללא zip · ${broken.length} לא לפי הנוהל · ${multiple.length} הגישו יותר מפעם אחת${
    deadline ? ` · באיחור מ-${e(formatIsraelTime(deadline))}` : ''
  } · הופק ${e(formatIsraelTime(new Date()))}</p>
<div class="sections">
${section(
  'לא הוגש לפי הנוהל',
  broken.map((r) => `<li>${who(r)}<ul>${r.violations.map((v) => `<li>${e(v)}</li>`).join('')}</ul></li>`),
)}
${section(
  'הגשות מרובות (נלקחה האחרונה)',
  multiple.map((r) => `<li>${who(r)}: ${e(multipleNote(r))}</li>`),
)}
${section('לא הורד קובץ zip', noZip.map((r) => `<li>${who(r)}: ${e(zipStatus(r))}</li>`))}
${section('לא נמצאו ת"ז', noIds.map((r) => `<li>${who(r)}</li>`))}
${section(
  'מיילים ללא מספר תרגיל (לא הורדו)',
  unclassified.map((m) => `<li><b>${e(m.group)}</b> ${e(formatIsraelTime(m.date))} – ${e(m.subject)}</li>`),
)}
</div>
<div class="wrap">
<table>
<thead><tr><th>קבוצה</th><th>ת"ז</th><th>מועד הגשה</th><th>צפייה</th><th>zip</th><th>קובץ</th><th>הגשות</th><th>לפי הנוהל</th><th>נושא המייל</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
</body>
</html>
`;
}
