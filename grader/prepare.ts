import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { findGroup } from './mail-parse';
import { groupsFile, manifestPath, submissionsDir, workDir } from './paths';
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
 * Copies or extracts every entry of submissions/<exercise>/ into .work/<exercise>/<id>/,
 * finds each student's entry HTML and writes the manifest the tests are generated from.
 */
export function prepare(exercise: string): PrepareReport {
  const source = submissionsDir(exercise);
  if (!fs.existsSync(source)) throw new Error(`Submissions folder not found: ${source}`);
  const work = workDir(exercise);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });

  const warnings: string[] = [];
  const submissions: Submission[] = [];
  const used = new Set<string>();
  const groups = loadGroups(exercise);
  for (const name of fs.readdirSync(source).sort()) {
    if (name.startsWith('.') || JUNK.has(name.toLowerCase())) continue;
    const id = uniqueId(studentId(name, warnings), used, warnings);
    const rootDir = path.join(work, id);
    const submission: Submission = { id, source: name };
    if (findGroup(id) === id) Object.assign(submission, { group: id, students: groups[id]?.students ?? [] });
    try {
      importEntry(path.join(source, name), rootDir);
      extractNestedZips(rootDir);
      const entry = findEntryHtml(rootDir);
      if (entry) Object.assign(submission, { rootDir, entry: toPosix(path.relative(rootDir, entry)) });
      else submission.error = 'לא נמצא קובץ HTML בהגשה';
    } catch (error) {
      submission.error = (error as Error).message;
    }
    if (submission.error) warnings.push(`${id}: cannot be graded automatically (${name})`);
    submissions.push(submission);
  }
  fs.writeFileSync(manifestPath(exercise), JSON.stringify(submissions, null, 2));
  return { submissions, warnings };
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
