import fs from 'node:fs';
import path from 'node:path';
import { exercises } from '../exercises/registry';
import { pointsFor, type Comment } from './comments';
import { escapeHtml, gradeOf } from './output';
import { loadRoster, type Roster } from './roster';
import { resultsDir, submissionsDir } from './paths';
import type { StudentResult } from './types';

const USAGE = `Usage: npm run calibrate -- <exercise>

  Compares the script's grades (results/<exercise>/results.json, from npm run grade)
  with hand grading in submissions/<exercise>/.manual.json:

    { "cgroup12": { "keys": ["NO_RTL", "BOX_NO_SHADOW"], "notes": "why" }, ... }

  keys are comment keys from exercises/<exercise>/comments/. Writes results/<exercise>/calibration.md
  and calibration.html (the same comparison in Hebrew, with the students' names from groups.xlsx).`;

interface Manual {
  keys: string[];
  notes?: string;
}

interface Row {
  id: string;
  manual?: number;
  script?: number;
  onlyManual: string[];
  onlyScript: string[];
  /** The script's comments (keys), for the report. */
  scriptKeys: string[];
  notes?: string;
  status: 'agree' | 'differ' | 'not graded' | 'no manual grade';
}

async function main(): Promise<number> {
  const exercise = process.argv[2];
  const info = exercise ? exercises[exercise] : undefined;
  if (!info) {
    console.error(USAGE);
    return 1;
  }
  const resultsFile = path.join(resultsDir(exercise), 'results.json');
  const manualFile = path.join(submissionsDir(exercise), '.manual.json');
  if (!fs.existsSync(resultsFile)) return fail(`No results yet: run "npm run grade -- ${exercise}" first.`);
  if (!fs.existsSync(manualFile)) return fail(`No hand grading found: create ${path.relative(process.cwd(), manualFile)}.\n\n${USAGE}`);

  const results: StudentResult[] = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
  const manual: Record<string, Manual> = JSON.parse(fs.readFileSync(manualFile, 'utf8'));
  const table = info.comments;
  const unknown = Object.values(manual).flatMap((m) => m.keys.filter((k) => !table[k]));
  if (unknown.length) return fail(`Unknown comment keys in .manual.json: ${[...new Set(unknown)].join(', ')}`);

  const ids = [...new Set([...Object.keys(manual), ...results.map((r) => r.id)])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const rows: Row[] = ids.map((id) => {
    const m = manual[id];
    const r = results.find((x) => x.id === id);
    const scriptKeys = r?.flags.map((f) => f.key) ?? [];
    const manualKeys = m?.keys ?? [];
    // Per-unit comments: the script's count is the best guess for the hand grade too.
    const points = (key: string) => r?.flags.find((f) => f.key === key)?.points ?? pointsFor(table[key]);
    const row: Row = {
      id,
      manual: m ? Math.max(0, 100 - manualKeys.reduce((sum, k) => sum + points(k), 0)) : undefined,
      script: r ? gradeOf(r) : undefined,
      scriptKeys,
      onlyManual: manualKeys.filter((k) => !scriptKeys.includes(k)),
      onlyScript: scriptKeys.filter((k) => !manualKeys.includes(k)),
      notes: m?.notes,
      status: 'agree',
    };
    if (!r) row.status = 'not graded';
    else if (!m) row.status = 'no manual grade';
    else if (row.onlyManual.length || row.onlyScript.length || row.manual !== row.script) row.status = 'differ';
    return row;
  });

  const label = (key: string) => `${table[key].no} ${key} (${pointsFor(table[key])})`;
  for (const row of rows) {
    const grades = `manual ${row.manual ?? '-'} · script ${row.script ?? '-'}`;
    console.log(`${row.status === 'agree' ? '✔' : '✘'} ${row.id.padEnd(12)} ${grades.padEnd(26)} ${row.status}`);
    for (const k of row.onlyManual) console.log(`     only in manual grading: ${label(k)}`);
    for (const k of row.onlyScript) console.log(`     only found by script:   ${label(k)}`);
  }
  const compared = rows.filter((r) => r.status === 'agree' || r.status === 'differ');
  const agree = compared.filter((r) => r.status === 'agree').length;
  console.log(`\n${agree}/${compared.length} graded submission(s) agree with the hand grading (comments table v${info.commentsVersion})`);

  const md = [
    `# Calibration – ${exercise} (comments table v${info.commentsVersion})`,
    '',
    `${agree}/${compared.length} graded submissions agree with the hand grading.`,
    '',
    '| Submission | Manual | Script | Only in manual grading | Only found by script | Notes |',
    '|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.manual ?? '–'} | ${r.script ?? '–'} | ${r.onlyManual.map(label).join('<br>') || (r.status === 'differ' ? '' : '✓')} | ${r.onlyScript.map(label).join('<br>')} | ${(r.notes ?? r.status).replace(/\|/g, '\\|')} |`,
    ),
    '',
  ].join('\n');
  const out = path.join(resultsDir(exercise), 'calibration.md');
  fs.writeFileSync(out, md);
  console.log(`  ${path.relative(process.cwd(), out)}`);
  const html = path.join(resultsDir(exercise), 'calibration.html');
  fs.writeFileSync(html, reportHtml(info.title, info.commentsVersion, rows, table, await loadRoster()));
  console.log(`  ${path.relative(process.cwd(), html)}`);
  return 0;
}

const STATUS: Record<Row['status'], string> = {
  agree: 'תואם',
  differ: 'שונה',
  'not graded': 'לא נבדק בסקריפט',
  'no manual grade': 'אין בדיקה ידנית',
};

/** The comparison in Hebrew (right to left, self-contained): one row per submission, with the students from the roster. */
function reportHtml(title: string, version: number, rows: Row[], table: Record<string, Comment>, roster?: Roster): string {
  const e = escapeHtml;
  const compared = rows.filter((r) => r.status === 'agree' || r.status === 'differ');
  const agree = compared.filter((r) => r.status === 'agree').length;
  const average = (values: (number | undefined)[]) => {
    const list = values.filter((v): v is number => v !== undefined);
    return list.length ? (list.reduce((a, b) => a + b, 0) / list.length).toFixed(1) : '–';
  };
  const comments = (keys: string[]) =>
    keys.length
      ? `<ul>${keys.map((k) => `<li><b>${table[k].no}</b> ${e(table[k].text)} <span class="pts">(${pointsFor(table[k])})</span></li>`).join('')}</ul>`
      : '';
  const students = (id: string) =>
    (roster?.groups.get(id) ?? []).map((s) => `${e(s.name)} <span class="muted">${e(s.id)}</span>`).join('<br>');
  const graded = new Set(rows.map((r) => r.id));
  const missing = [...(roster?.groups.keys() ?? [])].filter((g) => !graded.has(g));
  const body = rows
    .map(
      (r) => `<tr class="${r.status === 'agree' ? '' : 'differ'}">
<td><b>${e(r.id)}</b></td>
<td>${students(r.id)}</td>
<td class="num">${r.script ?? '–'}</td>
<td class="num">${r.manual ?? '–'}</td>
<td>${e(STATUS[r.status])}</td>
<td>${r.scriptKeys.map((k) => `<span title="${e(table[k].text)}">${table[k].no}</span>`).join(', ')}</td>
<td>${comments(r.onlyManual)}</td>
<td>${comments(r.onlyScript)}</td>
<td class="notes">${e(r.notes ?? '')}</td>
</tr>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>השוואת בדיקה – ${e(title)}</title>
<style>
  :root { color-scheme: light; --line: #d0d7de; --muted: #57606a; --differ: #fff1e6; }
  body { font-family: Arial, sans-serif; margin: 24px; color: #1f2328; background: #fff; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .summary { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0; }
  .summary div { border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; }
  .summary b { display: block; font-size: 22px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { border: 1px solid var(--line); padding: 6px 8px; vertical-align: top; text-align: right; }
  th { background: #f6f8fa; position: sticky; top: 0; }
  tr.differ td { background: var(--differ); }
  td.num { text-align: center; font-weight: bold; }
  td.notes { color: var(--muted); max-width: 420px; }
  ul { margin: 0; padding-inline-start: 18px; }
  .muted, .pts { color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<h1>השוואת הבדיקה האוטומטית לבדיקה הידנית</h1>
<div class="muted">${e(title)} · טבלת הערות גרסה ${version}</div>
<div class="summary">
  <div><b>${agree}/${compared.length}</b>הגשות שבהן הבדיקה האוטומטית תואמת לבדיקה הידנית</div>
  <div><b>${average(compared.map((r) => r.script))}</b>ממוצע הציונים בסקריפט</div>
  <div><b>${average(compared.map((r) => r.manual))}</b>ממוצע הציונים בבדיקה הידנית</div>
</div>
${missing.length ? `<p>קבוצות ברשימת הקבוצות ללא הגשה: ${missing.map(e).join(', ')}</p>` : ''}
<table>
<thead><tr><th>קבוצה</th><th>סטודנטים</th><th>ציון בסקריפט</th><th>ציון ידני</th><th>מצב</th><th>מספרי הערות (סקריפט)</th><th>הערות שניתנו רק בבדיקה הידנית</th><th>הערות שניתנו רק בסקריפט</th><th>הערות הבודק</th></tr></thead>
<tbody>
${body}
</tbody>
</table>
</body>
</html>
`;
}

function fail(message: string): number {
  console.error(message);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
