import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import fs from 'node:fs';
import path from 'node:path';
import {
  assignGroup,
  classifyLinks,
  exerciseHint,
  extractLinks,
  findCourseGroup,
  findGroup,
  findStudentIds,
  formatIsraelTime,
  isServerUrl,
  parseDeadline,
  parseIsraelTime,
  protocolViolations,
  type GroupSource,
} from './mail-parse';
import { ROOT, groupsFile, manualDir, resultsDir, submissionsDir, unzippedDir } from './paths';
import { extractSubmission, LINKS_FILE, manualSubmissions, readLinksFile } from './prepare';
import { loadCourseGroups } from './groups';
import { loadRoster, ROSTER_FILE, type Roster } from './roster';
import { SCHEDULE_FILE, exerciseNumber, loadSchedule, resolveExercise, type ScheduleEntry } from './schedule';
import { writeSubmissionsReport, type UnclassifiedMail } from './submissions-report';
import type { GroupRecord } from './types';

const USAGE = `Usage: npm run fetch -- <exercise> [--since YYYY-MM-DD] [--deadline "YYYY-MM-DD HH:mm"] [--no-label]

  Scans the course mailbox for submission mails (any subject containing cgroupXX, or a
  mistyped prefix like bgroupXX for a known group; or a mail with a server link or zip from a
  student in groups.xlsx), decides each mail's group (the group folder in its zip link first,
  then the sender and IDs in groups.xlsx, then the subject), downloads each group's zip into submissions/<exercise>/cgroupXX.zip and writes
  results/<exercise>/submissions.html and submissions.xlsx.

  --since      only mails from this date on (default: the publish date in exercises/schedule.md)
  --deadline   Israel time; later mails are marked late. A date alone means the whole
               day counts (late from the next day 00:00); default: the due date in
               exercises/schedule.md
  --no-label   don't label the exercise's mails in Gmail (default: every mail of the
               exercise gets the label HW<N>-<year>, e.g. HW1-2026; the year is the
               semester's first publish year in exercises/schedule.md)

  Needs GMAIL_USER and GMAIL_APP_PASSWORD in .env (see .env.example).`;

/** One parsed submission mail. */
interface Mail {
  uid: number;
  date: Date;
  subject: string;
  from: string;
  /** The sender's address, lower case (matched against the roster and mail-groups.json). */
  fromAddress: string;
  /** Decided by `assignGroup` after parsing. */
  group: string;
  assignedBy?: GroupSource;
  assignNotes: string[];
  /** The exercise number the subject (or links) claim; combined with the date by resolveExercise. */
  exerciseHint?: number;
  exercise?: number;
  exerciseKey?: string;
  exerciseConflict: boolean;
  students: string[];
  subjectIds: string[];
  zipUrl?: string;
  viewUrl?: string;
  externalUrls: string[];
  zipAttachment?: Buffer;
  /** Plain-text body, saved to submissions/<exercise>/.mail/<group>.txt. */
  body: string;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const exercise = args.shift();
  const options = parseOptions(args);
  if (!exercise || !/^ex\d+[a-z]?$/.test(exercise) || !options) {
    console.error(USAGE);
    return 1;
  }
  const number = exerciseNumber(exercise);
  const schedule = loadSchedule();
  const entry = schedule.find((e) => e.key === exercise);
  if (!entry) console.warn(`  ! ${exercise} is not in ${path.relative(ROOT, SCHEDULE_FILE)}: scanning the last 120 days, no deadline`);
  const since = options.since ?? entry?.publish ?? new Date(Date.now() - 120 * 24 * 3600 * 1000);
  const deadline = options.deadline ?? entry?.due;

  if (fs.existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '');
  if (!user || !pass) {
    console.error('Missing GMAIL_USER / GMAIL_APP_PASSWORD. Copy .env.example to .env and fill it in.');
    return 1;
  }

  console.log(`${exercise}: mails from ${formatIsraelTime(since)}${deadline ? `, late from ${formatIsraelTime(deadline)}` : ', no deadline'}`);
  console.log(`Scanning ${user} for cgroup mails...`);
  const roster = await loadRoster();
  if (roster) console.log(`Roster ${path.relative(ROOT, ROSTER_FILE)}: ${roster.groups.size} group(s), ${roster.byId.size} student(s)`);
  else console.warn(`  ! ${path.relative(ROOT, ROSTER_FILE)} not found: groups come from the mails only, students from the subjects`);
  const known = roster ? new Set(roster.groups.keys()) : loadCourseGroups();
  const mails = await readMails(user, pass, since, known, roster);
  // The subject's tarN and the mail date together decide the exercise (and the part, for ex5a/ex5b).
  for (const m of mails) {
    const resolved = resolveExercise(schedule, m.exerciseHint, m.date);
    Object.assign(m, { exercise: resolved.number, exerciseKey: resolved.key, exerciseConflict: resolved.conflict });
  }
  // Each mail's group: the group folder in its links first, then the roster, then the subject.
  const byHand = loadMailGroups(exercise);
  for (const m of mails) {
    const assigned = assignGroup({ ...m, ids: m.students }, roster, byHand, known);
    Object.assign(m, { group: assigned.group ?? '', assignedBy: assigned.by, assignNotes: assigned.conflicts });
  }
  const forExercise = mails.filter((m) => {
    if (m.exerciseKey !== exercise || !m.group) return false;
    if (m.assignedBy !== 'subject' && m.assignedBy !== 'link' || m.assignNotes.length) {
      console.log(`  · ${m.group} (assigned by ${m.assignedBy}): "${m.subject}" from ${m.fromAddress}${m.assignNotes.length ? ` – other sources disagree` : ''}`);
    }
    return true;
  });
  const unclassified: UnclassifiedMail[] = mails
    .filter((m) => m.exercise === undefined && m.group)
    .map((m) => ({ group: m.group, date: m.date.toISOString(), subject: m.subject, from: m.from }));
  console.log(`  ${mails.length} cgroup mail(s), ${forExercise.length} for ${exercise}, ${unclassified.length} without an exercise number`);
  if (options.label && forExercise.length) {
    const label = gmailLabel(exercise, schedule, since);
    try {
      const added = await labelMails(user, pass, forExercise.map((m) => m.uid), label);
      console.log(`  Gmail label "${label}" on ${forExercise.length} mail(s)${added ? ' (label created)' : ''}`);
    } catch (e) {
      console.warn(`  ! could not label the mails "${label}" in Gmail (${(e as Error).message})`);
    }
  }

  const byGroup = new Map<string, Mail[]>();
  for (const m of forExercise) byGroup.set(m.group, [...(byGroup.get(m.group) ?? []), m]);

  const dir = submissionsDir(exercise);
  const unzipped = unzippedDir(exercise);
  fs.rmSync(unzipped, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const records: Record<string, GroupRecord> = {};
  for (const group of [...byGroup.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const all = byGroup.get(group)!.sort((a, b) => a.date.getTime() - b.date.getTime());
    const latest = all[all.length - 1];
    const record = await collect(latest, number, path.join(dir, `${group}.zip`), roster);
    record.earlier = all.slice(0, -1).map((m) => ({ date: m.date.toISOString(), subject: m.subject, zipUrl: m.zipUrl }));
    if (deadline && latest.date >= deadline) {
      record.late = true;
      record.violations.push(`הוגש באיחור (${formatIsraelTime(latest.date)})`);
    }
    records[group] = record;
    if (record.zipSource) {
      try {
        extractSubmission(path.join(dir, `${group}.zip`), path.join(unzipped, group));
      } catch (e) {
        console.warn(`  ! ${group}: could not unzip for manual checking (${(e as Error).message})`);
      }
    }
    const status = record.zipSource ? `zip from ${record.zipSource}` : `NO ZIP (${record.error})`;
    const notes = [all.length > 1 && `${all.length} mails, latest used`, record.violations.length && `${record.violations.length} protocol issue(s)`]
      .filter(Boolean)
      .join(', ');
    console.log(`  ${record.zipSource ? '✔' : '✘'} ${group.padEnd(10)} ${status}${notes ? `  [${notes}]` : ''}`);
  }
  fs.writeFileSync(groupsFile(exercise), JSON.stringify(records, null, 2));
  removeStale(dir, records);

  // Hand-added zips replace the mailed ones in grading, so they replace them here too.
  // Submissions that came without a mail: manual-submissions/<ex>/cgroupNN/links.txt; download their zip once.
  await downloadLinkedZips(exercise);
  const manualWarnings: string[] = [];
  const manual = manualSubmissions(exercise, manualWarnings);
  for (const warning of manualWarnings) console.warn(`  ! ${warning}`);
  for (const [group, zip] of manual) {
    try {
      extractSubmission(zip, path.join(unzipped, group));
      console.log(`  ✔ ${group.padEnd(10)} manual submission (${path.relative(ROOT, zip)})${records[group] ? ', replaces the mailed zip' : ''}`);
    } catch (e) {
      console.warn(`  ! ${group}: could not unzip the manual submission (${(e as Error).message})`);
    }
  }

  const report = await writeSubmissionsReport(resultsDir(exercise), exercise, Object.values(records), unclassified, deadline);
  const rel = (p: string) => path.relative(process.cwd(), p);
  const list = Object.values(records);
  console.log(
    `\n${list.length} group(s) · ${list.filter((r) => !r.zipSource).length} without a zip · ` +
      `${list.filter((r) => r.violations.length).length} not according to the procedure · ` +
      `${list.filter((r) => r.earlier.length).length} submitted more than once`,
  );
  console.log(`  ${rel(dir)}/`);
  console.log(`  ${rel(unzipped)}/   (extracted, for checking by hand)`);
  for (const file of report) console.log(`  ${rel(file)}`);
  console.log(`\nNext: npm run grade -- ${exercise}\n`);
  return 0;
}

/**
 * manual-submissions/<exercise>/mail-groups.json: { "sender@address": "cgroupNN" }, for mails whose
 * subject names the wrong group. Applied before the mails are grouped.
 */
function loadMailGroups(exercise: string): Map<string, string> {
  const file = path.join(manualDir(exercise), 'mail-groups.json');
  const map = new Map<string, string>();
  if (!fs.existsSync(file)) return map;
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
  for (const [address, value] of Object.entries(data)) {
    const group = findGroup(value);
    if (group) map.set(address.trim().toLowerCase(), group);
    else console.warn(`  ! ${path.relative(ROOT, file)}: "${value}" is not a cgroupNN, ignored`);
  }
  return map;
}

/** For each manual-submissions/<ex>/cgroupNN/ folder with links.txt and no zip yet: downloads the zip from the zip link. */
async function downloadLinkedZips(exercise: string) {
  const dir = manualDir(exercise);
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const folder = path.join(dir, name);
    if (!findGroup(name) || !fs.statSync(folder).isDirectory()) continue;
    if (fs.readdirSync(folder).some((f) => f.toLowerCase().endsWith('.zip'))) continue;
    const links = readLinksFile(folder);
    if (!links) continue;
    if (!links.zipUrl) {
      console.warn(`  ! ${name}: ${LINKS_FILE} has no zip link`);
      continue;
    }
    const result = await downloadZip(links.zipUrl);
    if ('error' in result) {
      console.warn(`  ! ${name}: could not download the zip from ${LINKS_FILE} (${result.error})`);
      continue;
    }
    const file = path.join(folder, decodeURIComponent(path.posix.basename(new URL(links.zipUrl).pathname)) || 'submission.zip');
    fs.writeFileSync(file, result.data);
    console.log(`  ✔ ${name.padEnd(10)} zip downloaded from ${LINKS_FILE} (${path.relative(ROOT, file)})`);
  }
}

/** Zips and mail texts left from earlier runs for groups that have no mail now (they would be graded again). */
function removeStale(dir: string, records: Record<string, GroupRecord>) {
  const stale = (name: string, ext: string) => {
    if (!name.toLowerCase().endsWith(ext)) return false;
    const group = findGroup(name);
    return !!group && group === name.slice(0, -ext.length).toLowerCase() && !records[group];
  };
  for (const name of fs.readdirSync(dir)) {
    if (stale(name, '.zip')) {
      fs.rmSync(path.join(dir, name));
      console.log(`  · removed ${name} (left from an earlier run; no mail from this group now)`);
    }
  }
  const mailDir = path.join(dir, '.mail');
  for (const name of fs.existsSync(mailDir) ? fs.readdirSync(mailDir) : []) {
    if (stale(name, '.txt')) fs.rmSync(path.join(mailDir, name));
  }
}

function parseOptions(args: string[]): { since?: Date; deadline?: Date; label: boolean } | undefined {
  const options: { since?: Date; deadline?: Date; label: boolean } = { label: true };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--no-label') {
      options.label = false;
      continue;
    }
    const [flag, inline] = args[i].split('=', 2);
    const value = inline ?? args[++i];
    if (!value) return undefined;
    if (flag === '--since') options.since = parseIsraelTime(`${value} 00:00`);
    else if (flag === '--deadline') options.deadline = parseDeadline(value);
    else return undefined;
  }
  return options;
}

/**
 * The Gmail label for an exercise's mails: HW<number+part>-<year>, e.g. HW1-2026, HW5a-2026. The year is
 * the semester's (the earliest publish date in the schedule), so a semester's exercises share it.
 */
export function gmailLabel(exercise: string, schedule: ScheduleEntry[], since: Date): string {
  const first = schedule.map((e) => e.publish).sort((a, b) => a.getTime() - b.getTime())[0] ?? since;
  const year = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Jerusalem', year: 'numeric' }).format(first);
  return `HW${exercise.replace(/^ex/i, '')}-${year}`;
}

/** Adds the Gmail label to the mails (UIDs in All Mail), creating it first if needed; true when created. */
async function labelMails(user: string, pass: string, uids: number[], label: string): Promise<boolean> {
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
  await client.connect();
  try {
    const boxes = await client.list();
    const allMail = boxes.find((b) => b.specialUse === '\\All')?.path ?? 'INBOX';
    const created = !boxes.some((b) => b.path === label);
    if (created) await client.mailboxCreate(label);
    const lock = await client.getMailboxLock(allMail);
    try {
      const ok = await client.messageFlagsAdd(uids, [label], { uid: true, useLabels: true });
      if (!ok) throw new Error('the server refused the label (no Gmail X-GM-EXT-1 support?)');
    } finally {
      lock.release();
    }
    return created;
  } finally {
    await client.logout().catch(() => undefined);
  }
}

/** Every mail since `since` whose subject contains cgroupXX (from any folder, not sent by the course account). */
async function readMails(user: string, pass: string, since: Date, groups: Set<string>, roster?: Roster): Promise<Mail[]> {
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
  await client.connect();
  try {
    const boxes = await client.list();
    const allMail = boxes.find((b) => b.specialUse === '\\All')?.path ?? 'INBOX';
    const lock = await client.getMailboxLock(allMail);
    try {
      const uids = (await client.search({ since }, { uid: true })) || [];
      if (!uids.length) return [];
      // Gmail's search is word based and can't find "cgroup" inside "cgroup12", so filter here.
      const matching: number[] = [];
      for await (const msg of client.fetch(uids, { envelope: true, uid: true }, { uid: true })) {
        const senders = (msg.envelope?.from ?? []).map((a) => a.address?.toLowerCase() ?? '');
        if (senders.includes(user.toLowerCase())) continue;
        const student = senders.some((a) => roster?.byEmail.has(a));
        if (findCourseGroup(msg.envelope?.subject ?? '', groups) || student) matching.push(msg.uid);
      }
      const mails: Mail[] = [];
      for (const uid of matching) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const mail = toMail(uid, await simpleParser(msg.source));
        // A student's mail without a group in the subject is a submission only if it has a server link or a zip
        // (otherwise e.g. a question to the lecturer would replace the group's submission).
        const submits = !!mail.zipAttachment || isServerUrl(mail.zipUrl) || isServerUrl(mail.viewUrl);
        if (findCourseGroup(mail.subject, groups) || submits) mails.push(mail);
      }
      return mails;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}

function toMail(uid: number, parsed: ParsedMail): Mail {
  const subject = (parsed.subject ?? '').trim();
  const text = parsed.text ?? '';
  const html = typeof parsed.html === 'string' ? parsed.html : '';
  const links = classifyLinks(extractLinks(text, html));
  const subjectIds = findStudentIds(subject);
  // Body IDs only when the subject has none; links are removed first so numbers in URLs don't count.
  const bodyText = (text || html.replace(/<[^>]+>/g, ' ')).replace(/\S*(?:https?:\/\/|ruppin\.ac\.il)\S*/gi, ' ');
  const zip = parsed.attachments.find((a) => /\.zip$/i.test(a.filename ?? '') || /zip/i.test(a.contentType));
  return {
    uid,
    date: parsed.date ?? new Date(0),
    subject,
    from: parsed.from?.text ?? '',
    fromAddress: (parsed.from?.value[0]?.address ?? '').toLowerCase(),
    group: '',
    assignNotes: [],
    exerciseHint: exerciseHint(subject, links),
    exerciseConflict: false,
    students: subjectIds.length ? subjectIds : findStudentIds(bodyText),
    subjectIds,
    ...links,
    zipAttachment: zip?.content,
    body: (text || html.replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, '')).trim(),
  };
}

/** Saves the group's zip (link first, then attachment) and checks the mail against the procedure. */
async function collect(mail: Mail, exercise: number, target: string, roster?: Roster): Promise<GroupRecord> {
  saveMailText(mail, path.join(path.dirname(target), '.mail', `${mail.group}.txt`));
  const record: GroupRecord = {
    group: mail.group,
    assignedBy: mail.assignedBy,
    ...(mail.assignNotes.length ? { assignNotes: mail.assignNotes } : {}),
    exercise,
    // The roster decides who is in the group (a subject may leave a student out); else the mail's IDs.
    students: roster?.groups.get(mail.group)?.map((s) => s.id) ?? mail.students,
    submittedAt: mail.date.toISOString(),
    subject: mail.subject,
    from: mail.from,
    viewUrl: mail.viewUrl,
    zipUrl: mail.zipUrl,
    zipSource: null,
    violations: protocolViolations({ ...mail, exercise, hasZipAttachment: !!mail.zipAttachment }),
    earlier: [],
  };
  if (mail.exerciseConflict) {
    record.violations.push(`מספר התרגיל בנושא/בלינק (tar${mail.exerciseHint}) אינו תואם למועד ההגשה – שויך לתרגיל ${exercise}`);
  }

  let linkError: string | undefined;
  if (mail.zipUrl) {
    const result = await downloadZip(mail.zipUrl);
    if ('data' in result) {
      fs.writeFileSync(target, result.data);
      record.zipSource = 'link';
      return record;
    }
    linkError = result.error;
    record.violations.push(`לינק ה-zip אינו תקין: ${result.error}`);
  }
  if (mail.zipAttachment && isZip(mail.zipAttachment)) {
    fs.writeFileSync(target, mail.zipAttachment);
    record.zipSource = 'attachment';
    return record;
  }
  record.error = linkError ?? (mail.zipAttachment ? 'הקובץ המצורף אינו zip תקין' : 'אין לינק ל-zip ואין zip מצורף');
  if (fs.existsSync(target)) {
    record.zipSource = 'previous';
    record.error += ' – נשמר קובץ שהורד בהרצה קודמת';
  }
  return record;
}

/** The mail as text (kept with the zip: the procedure checks grade its subject and links). */
function saveMailText(mail: Mail, file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [
    `From: ${mail.from}`,
    `Date: ${formatIsraelTime(mail.date)}`,
    `Subject: ${mail.subject}`,
    `View link: ${mail.viewUrl ?? '-'}`,
    `Zip link: ${mail.zipUrl ?? '-'}`,
    ...(mail.zipAttachment ? ['Zip attached: yes'] : []),
    '',
    mail.body,
  ];
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

const isZip = (data: Buffer) => data.length > 4 && data.readUInt32LE(0) === 0x04034b50;

async function downloadZip(url: string): Promise<{ data: Buffer } | { error: string }> {
  // The course server is sometimes reachable over http only.
  const candidates = url.startsWith('https://') ? [url, `http://${url.slice('https://'.length)}`] : [url];
  let error = '';
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { signal: AbortSignal.timeout(30_000), redirect: 'follow' });
      if (!response.ok) {
        error = `HTTP ${response.status}`;
        continue;
      }
      const data = Buffer.from(await response.arrayBuffer());
      if (isZip(data)) return { data };
      error = 'הקובץ שהתקבל אינו zip';
    } catch (e) {
      error = (e as Error).name === 'TimeoutError' ? 'השרת לא הגיב' : `שגיאת רשת (${(e as Error).message})`;
    }
  }
  return { error };
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
