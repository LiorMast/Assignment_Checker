import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import fs from 'node:fs';
import path from 'node:path';
import { findGroup } from './mail-parse';
import { ROOT } from './paths';

/**
 * The course roster, groups.xlsx (edited every semester; student data, git-ignored): one row per
 * group with up to three students (name, ID, email). It decides which students a group's grade
 * goes to, and helps tell which group a mail or zip belongs to. The group password column is
 * never read.
 */
export const ROSTER_FILE = path.join(ROOT, 'groups.xlsx');

export interface RosterStudent {
  name: string;
  id: string;
  /** Lower case. */
  email: string;
}

export interface Roster {
  /** cgroupNN → its students (groups without students are left out). */
  groups: Map<string, RosterStudent[]>;
  /** Student ID → group. */
  byId: Map<string, string>;
  /** Email (lower case) → group. */
  byEmail: Map<string, string>;
}

/** Reads the roster; undefined when the file doesn't exist. */
export async function loadRoster(file = ROSTER_FILE): Promise<Roster | undefined> {
  if (!fs.existsSync(file)) return undefined;
  // ExcelJS can't parse some table filters Excel writes (e.g. a color filter): drop the tables' autoFilter.
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  for (const name of Object.keys(zip.files).filter((n) => /^xl\/tables\/[^/]+\.xml$/i.test(n))) {
    const xml = await zip.file(name)!.async('string');
    zip.file(name, xml.replace(/<autoFilter\b[^>]*\/>|<autoFilter\b[\s\S]*?<\/autoFilter>/g, ''));
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await zip.generateAsync({ type: 'nodebuffer' })) as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return rosterFromRows([]);
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= sheet.columnCount; c++) cells.push(row.getCell(c).text.trim());
    rows.push(cells);
  });
  return rosterFromRows(rows);
}

/**
 * Builds the roster from the sheet's rows (the first row holds the headers). Columns are found by
 * their headers: "שם קבוצה", and "שם / ת.ז. / איימל סטודנט N" for each student N.
 */
export function rosterFromRows(rows: string[][]): Roster {
  const roster: Roster = { groups: new Map(), byId: new Map(), byEmail: new Map() };
  const headerAt = rows.findIndex((r) => r.some((h) => /שם\s*(ה)?קבוצה/.test(h)));
  if (headerAt < 0) return roster;
  const headers = rows[headerAt];
  const groupCol = headers.findIndex((h) => /שם\s*(ה)?קבוצה/.test(h));
  const studentCols = new Map<number, { name?: number; id?: number; email?: number }>();
  headers.forEach((h, col) => {
    const n = Number(h.match(/סטודנט\s*(\d+)/)?.[1]);
    if (!n) return;
    const entry = studentCols.get(n) ?? {};
    if (/ת\.?\s*ז/.test(h) || /\bid\b/i.test(h)) entry.id = col;
    else if (/מייל|אימייל|איימל|e-?mail/i.test(h)) entry.email = col;
    else if (/^שם/.test(h)) entry.name = col;
    studentCols.set(n, entry);
  });

  for (const row of rows.slice(headerAt + 1)) {
    const group = findGroup(row[groupCol] ?? '');
    if (!group) continue;
    const students: RosterStudent[] = [];
    for (const [, cols] of [...studentCols].sort(([a], [b]) => a - b)) {
      const id = (cols.id === undefined ? '' : row[cols.id] ?? '').replace(/\D/g, '');
      const name = cols.name === undefined ? '' : (row[cols.name] ?? '');
      const email = (cols.email === undefined ? '' : (row[cols.email] ?? '')).toLowerCase();
      if (!id && !name) continue;
      students.push({ name, id, email });
      if (id) roster.byId.set(id, group);
      if (email) roster.byEmail.set(email, group);
    }
    if (students.length) roster.groups.set(group, students);
  }
  return roster;
}
