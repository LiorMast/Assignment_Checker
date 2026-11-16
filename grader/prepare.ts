import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { classifyLinks, extractLinks, findGroup, findStudentIds } from './mail-parse';
import { loadRoster, type Roster } from './roster';
import { exerciseNumber } from './schedule';
import { ROOT, groupsFile, manifestPath, manualDir, submissionsDir, workDir } from './paths';
import type { GroupRecord, Submission } from './types';

/** Folders and files that are never part of a student's site. */
const JUNK = new Set(['__macosx', '.vs', '.vscode', '.idea', '.git', 'bin', 'obj', 'node_modules', '.ds_store', 'thumbs.db', 'desktop.ini']);
const UNSUPPORTED_ARCHIVES = ['.rar', '.7z', '.tar', '.gz', '.tgz'];

export interface PrepareReport {
  submissions: Submission[];
  /** Printed by the CLI (English: terminals render Hebrew poorly). */
  warnings: string[];
}

/**
 * Copies or extracts every entry of submissions/<exercise>/ (and the hand-added zips in
 * manual-submissions/<exercise>/) into .work/<exercise>/<id>/, finds each student's entry HTML
 * and writes the manifest the tests are generated from.
 */
export async function prepare(exercise: string): Promise<PrepareReport> {
  const source = submissionsDir(exercise);
  const warnings: string[] = [];
  const manual = manualSubmissions(exercise, warnings);
  if (!fs.existsSync(source) && !manual.size) throw new Error(`Submissions folder not found: ${source}`);
  const work = workDir(exercise);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });

  const submissions: Submission[] = [];
  const used = new Set<string>();
  const groups = loadGroups(exercise);
  const roster = await loadRoster();
  const add = (id: string, name: string, from: string, manual = false) => {
    const rootDir = path.join(work, id);
    const submission: Submission = { id, source: name, ...(manual ? { manual } : {}) };
    // The roster decides who is in the group; without it, the IDs from the mail.
    const students = roster?.groups.get(id)?.map((s) => s.id) ?? groups[id]?.students ?? [];
    if (findGroup(id) === id) Object.assign(submission, { group: id, students });
    const record = groups[id];
    const links = manual ? readLinksFile(path.dirname(from)) : undefined;
    if (record) {
      // .groups.json from before the exercise number was stored: the exercise being graded.
      const number = record.exercise ?? exerciseNumber(exercise);
      submission.mail = { subject: record.subject, viewUrl: record.viewUrl, zipUrl: record.zipUrl, exercise: number };
    } else if (links) {
      // Submitted without a mail: the links are graded, there is no subject.
      submission.mail = { viewUrl: links.viewUrl, zipUrl: links.zipUrl, exercise: exerciseNumber(exercise) };
    }
    try {
      importEntry(from, rootDir);
      extractNestedZips(rootDir);
      const entry = findEntryHtml(rootDir);
      if (entry) Object.assign(submission, { rootDir, entry: toPosix(path.relative(rootDir, entry)) });
      else submission.error = 'לא נמצא קובץ HTML בהגשה';
      const names = [path.basename(from), ...fs.readdirSync(rootDir), ...(record?.zipUrl ? [record.zipUrl.replace(/%20/g, ' ')] : [])];
      const foreign = submission.group ? foreignGroups(names, submission.group, roster) : [];
      if (foreign.length) {
        submission.notes = [`שם ה-zip/התיקייה מכיל ת"ז של ${foreign.join(', ')} – כדאי לבדוק שההגשה שייכת ל-${submission.group}`];
        warnings.push(`${id}: the zip/folder names hold IDs of ${foreign.join(', ')} (${name})`);
      }
    } catch (error) {
      submission.error = (error as Error).message;
    }
    if (submission.error) warnings.push(`${id}: cannot be graded automatically (${name})`);
    submissions.push(submission);
  };

  for (const name of fs.existsSync(source) ? fs.readdirSync(source).sort() : []) {
    if (name.startsWith('.') || JUNK.has(name.toLowerCase())) continue;
    const id = studentId(name, warnings);
    if (manual.has(id)) {
      warnings.push(`${id}: using the manual submission instead of ${name}`);
      continue;
    }
    if (Object.keys(groups).length && findGroup(id) === id && !groups[id]) {
      warnings.push(`${id}: ${name} has no mail in .groups.json (left from an earlier fetch?) – graded without student IDs`);
    }
    add(uniqueId(id, used, warnings), name, path.join(source, name));
  }
  for (const [group, zip] of manual) add(uniqueId(group, used, warnings), toPosix(path.relative(ROOT, zip)), zip, true);
  submissions.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  fs.writeFileSync(manifestPath(exercise), JSON.stringify(submissions, null, 2));
  return { submissions, warnings };
}

/**
 * Hand-added submissions: manual-submissions/<exercise>/cgroupNN/ holding one zip.
 * Returns group → zip path (the newest zip when a folder holds several).
 */
export function manualSubmissions(exercise: string, warnings: string[]): Map<string, string> {
  const dir = manualDir(exercise);
  const found = new Map<string, string>();
  if (!fs.existsSync(dir)) return found;
  const where = toPosix(path.relative(ROOT, dir));
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || JUNK.has(entry.name.toLowerCase())) continue;
    if (entry.name === 'mail-groups.json') continue; // read by npm run fetch
    if (!entry.isDirectory()) {
      warnings.push(`${where}/${entry.name}: ignored (expected a cgroupNN folder holding one zip)`);
      continue;
    }
    const group = findGroup(entry.name);
    if (!group) {
      warnings.push(`${where}/${entry.name}: ignored (folder name is not cgroupNN)`);
      continue;
    }
    const folder = path.join(dir, entry.name);
    const zips = fs
      .readdirSync(folder)
      .filter((f) => f.toLowerCase().endsWith('.zip'))
      .map((f) => path.join(folder, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (!zips.length) {
      warnings.push(`${where}/${entry.name}: no zip in the folder, ignored`);
      continue;
    }
    if (zips.length > 1) warnings.push(`${where}/${entry.name}: ${zips.length} zips, using the newest (${path.basename(zips[0])})`);
    if (found.has(group)) warnings.push(`${where}/${entry.name}: another folder is also ${group}, using this one`);
    found.set(group, zips[0]);
  }
  return found;
}

export function loadManifest(exercise: string): Submission[] {
  const file = manifestPath(exercise);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}

/** Every file under `dir` (absolute paths), skipping junk folders. */
export function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (JUNK.has(entry.name.toLowerCase())) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

export const toPosix = (p: string) => p.split(path.sep).join('/');

/** The file in a manual-submissions/<ex>/cgroupNN/ folder holding the links of a submission that came without a mail. */
export const LINKS_FILE = 'links.txt';

/** The view and zip links in the folder's links.txt (any text; found like the links in a mail). */
export function readLinksFile(folder: string): { viewUrl?: string; zipUrl?: string } | undefined {
  const file = path.join(folder, LINKS_FILE);
  if (!fs.existsSync(file)) return undefined;
  return linksFromText(fs.readFileSync(file, 'utf8'));
}

export function linksFromText(text: string): { viewUrl?: string; zipUrl?: string } {
  const { viewUrl, zipUrl } = classifyLinks(extractLinks(text));
  return { viewUrl, zipUrl };
}

/**
 * Groups other than `group` whose students' IDs appear in the zip/folder names (e.g. a hand-added zip
 * put in the wrong group's folder). IDs not in the roster (typos) are ignored.
 */
export function foreignGroups(names: string[], group: string, roster?: Pick<Roster, 'byId'>): string[] {
  if (!roster) return [];
  const ids = names.flatMap((n) => findStudentIds(n));
  return [...new Set(ids.map((id) => roster.byId.get(id)).filter((g): g is string => !!g && g !== group))].sort();
}

/** Mail details written by `npm run fetch` (empty when the zips were put there by hand). */
function loadGroups(exercise: string): Record<string, GroupRecord> {
  const file = groupsFile(exercise);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

/** cgroupNN for group submissions, otherwise the student's 8-9 digit ID. */
function studentId(name: string, warnings: string[]): string {
  const group = findGroup(name);
  if (group) return group;
  const match = name.match(/(?<!\d)\d{8,9}(?!\d)/);
  if (match) return match[0];
  const cleaned = path.parse(name).name.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '') || 'unnamed';
  warnings.push(`"${name}": no 8-9 digit ID in the name, using "${cleaned}"`);
  return cleaned;
}

function uniqueId(id: string, used: Set<string>, warnings: string[]): string {
  let unique = id;
  for (let n = 2; used.has(unique); n++) unique = `${id}-${n}`;
  if (unique !== id) warnings.push(`${id}: duplicate submission, stored as ${unique}`);
  used.add(unique);
  return unique;
}

function importEntry(from: string, to: string) {
  if (fs.statSync(from).isDirectory()) {
    fs.cpSync(from, to, { recursive: true, filter: (p) => p === from || !JUNK.has(path.basename(p).toLowerCase()) });
    return;
  }
  const ext = path.extname(from).toLowerCase();
  if (ext === '.zip') return extractZip(from, to);
  if (UNSUPPORTED_ARCHIVES.includes(ext)) {
    throw new Error(`פורמט ארכיון לא נתמך (${ext}) – יש לחלץ ידנית לתיקייה בשם הת"ז ולהריץ שוב`);
  }
  // A single loose file (e.g. just index.html).
  fs.mkdirSync(to, { recursive: true });
  fs.copyFileSync(from, path.join(to, path.basename(from)));
}

/** Extracts a submission zip (and the zips inside it) into `to`, skipping junk folders; used by fetch for manual checking. */
export function extractSubmission(zipFile: string, to: string) {
  fs.rmSync(to, { recursive: true, force: true });
  extractZip(zipFile, to);
  extractNestedZips(to);
}

function extractZip(zipFile: string, to: string) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of new AdmZip(zipFile).getEntries()) {
    if (entry.isDirectory) continue;
    const parts = entry.entryName.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.some((p) => p === '..' || JUNK.has(p.toLowerCase()))) continue;
    const dest = path.join(to, ...parts);
    if (!dest.startsWith(to + path.sep)) continue; // zip-slip guard
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entry.getData());
  }
}

/** Moodle-style folders hold the student's zip, and zips sometimes hold zips. */
function extractNestedZips(dir: string, depth = 0) {
  if (depth > 2) return;
  for (const file of listFiles(dir)) {
    if (!file.toLowerCase().endsWith('.zip')) continue;
    const target = file.slice(0, -'.zip'.length);
    extractZip(file, target);
    fs.rmSync(file);
    extractNestedZips(target, depth + 1);
  }
}

/** Shallowest index.html (any case); otherwise the most likely page among the HTML files. */
function findEntryHtml(dir: string): string | undefined {
  const pages = listFiles(dir).filter((f) => /\.html?$/i.test(f));
  const depth = (f: string) => path.relative(dir, f).split(path.sep).length;
  const isIndex = (f: string) => path.basename(f).toLowerCase() === 'index.html';
  const linksCss = (f: string) => /<link[^>]+stylesheet/i.test(fs.readFileSync(f, 'utf8'));
  return pages.sort(
    (a, b) =>
      Number(isIndex(b)) - Number(isIndex(a)) ||
      depth(a) - depth(b) ||
      Number(linksCss(b)) - Number(linksCss(a)) ||
      a.localeCompare(b),
  )[0];
}
