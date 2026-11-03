import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import fs from 'node:fs';
import path from 'node:path';
import {
  classifyLinks,
  exerciseOf,
  extractLinks,
  findGroup,
  findStudentIds,
  formatIsraelTime,
  parseDeadline,
  parseIsraelTime,
  protocolViolations,
} from './mail-parse';
import { ROOT, groupsFile, resultsDir, submissionsDir } from './paths';
import { SCHEDULE_FILE, exerciseKeyFor, exerciseNumber, loadSchedule } from './schedule';
import { writeSubmissionsReport, type UnclassifiedMail } from './submissions-report';
import type { GroupRecord } from './types';

const USAGE = `Usage: npm run fetch -- <exercise> [--since YYYY-MM-DD] [--deadline "YYYY-MM-DD HH:mm"]

  Scans the course mailbox for submission mails (any subject containing cgroupXX),
  downloads each group's zip into submissions/<exercise>/cgroupXX.zip and writes
  results/<exercise>/submissions.html and submissions.xlsx.

  --since      only mails from this date on (default: the publish date in exercises/schedule.md)
  --deadline   Israel time; later mails are marked late. A date alone means the whole
               day counts (late from the next day 00:00); default: the due date in
               exercises/schedule.md

  Needs GMAIL_USER and GMAIL_APP_PASSWORD in .env (see .env.example).`;

/** One parsed submission mail. */
interface Mail {
  uid: number;
  date: Date;
  subject: string;
  from: string;
  group: string;
  exercise?: number;
  students: string[];
  subjectIds: string[];
  zipUrl?: string;
  viewUrl?: string;
  externalUrls: string[];
  zipAttachment?: Buffer;
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
  const mails = await readMails(user, pass, since);
  // Exercise parts share a number (tar5 for ex5a and ex5b): the mail's date decides which part it is.
  const forExercise = mails.filter((m) => m.exercise === number && exerciseKeyFor(schedule, number, m.date) === exercise);
  const unclassified: UnclassifiedMail[] = mails
    .filter((m) => m.exercise === undefined)
    .map((m) => ({ group: m.group, date: m.date.toISOString(), subject: m.subject, from: m.from }));
  console.log(`  ${mails.length} cgroup mail(s), ${forExercise.length} for ${exercise}, ${unclassified.length} without an exercise number`);

  const byGroup = new Map<string, Mail[]>();
  for (const m of forExercise) byGroup.set(m.group, [...(byGroup.get(m.group) ?? []), m]);

  const dir = submissionsDir(exercise);
  fs.mkdirSync(dir, { recursive: true });
  const records: Record<string, GroupRecord> = {};
  for (const group of [...byGroup.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const all = byGroup.get(group)!.sort((a, b) => a.date.getTime() - b.date.getTime());
    const latest = all[all.length - 1];
    const record = await collect(latest, number, path.join(dir, `${group}.zip`));
    record.earlier = all.slice(0, -1).map((m) => ({ date: m.date.toISOString(), subject: m.subject, zipUrl: m.zipUrl }));
    if (deadline && latest.date >= deadline) {
      record.late = true;
      record.violations.push(`הוגש באיחור (${formatIsraelTime(latest.date)})`);
    }
    records[group] = record;
    const status = record.zipSource ? `zip from ${record.zipSource}` : `NO ZIP (${record.error})`;
    const notes = [all.length > 1 && `${all.length} mails, latest used`, record.violations.length && `${record.violations.length} protocol issue(s)`]
      .filter(Boolean)
      .join(', ');
    console.log(`  ${record.zipSource ? '✔' : '✘'} ${group.padEnd(10)} ${status}${notes ? `  [${notes}]` : ''}`);
  }
  fs.writeFileSync(groupsFile(exercise), JSON.stringify(records, null, 2));

  const report = await writeSubmissionsReport(resultsDir(exercise), exercise, Object.values(records), unclassified, deadline);
  const rel = (p: string) => path.relative(process.cwd(), p);
  const list = Object.values(records);
  console.log(
    `\n${list.length} group(s) · ${list.filter((r) => !r.zipSource).length} without a zip · ` +
      `${list.filter((r) => r.violations.length).length} not according to the procedure · ` +
      `${list.filter((r) => r.earlier.length).length} submitted more than once`,
  );
  console.log(`  ${rel(dir)}/`);
  for (const file of report) console.log(`  ${rel(file)}`);
  console.log(`\nNext: npm run grade -- ${exercise}\n`);
  return 0;
}

function parseOptions(args: string[]): { since?: Date; deadline?: Date } | undefined {
  const options: { since?: Date; deadline?: Date } = {};
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].split('=', 2);
    const value = inline ?? args[++i];
    if (!value) return undefined;
    if (flag === '--since') options.since = parseIsraelTime(`${value} 00:00`);
    else if (flag === '--deadline') options.deadline = parseDeadline(value);
    else return undefined;
  }
  return options;
}

/** Every mail since `since` whose subject contains cgroupXX (from any folder, not sent by the course account). */
async function readMails(user: string, pass: string, since: Date): Promise<Mail[]> {
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
        const fromSelf = msg.envelope?.from?.some((a) => a.address?.toLowerCase() === user.toLowerCase());
        if (!fromSelf && findGroup(msg.envelope?.subject ?? '')) matching.push(msg.uid);
      }
      const mails: Mail[] = [];
      for (const uid of matching) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (msg && msg.source) mails.push(toMail(uid, await simpleParser(msg.source)));
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
    group: findGroup(subject)!,
    exercise: exerciseOf(subject, links),
    students: subjectIds.length ? subjectIds : findStudentIds(bodyText),
    subjectIds,
    ...links,
    zipAttachment: zip?.content,
  };
}

/** Saves the group's zip (link first, then attachment) and checks the mail against the procedure. */
async function collect(mail: Mail, exercise: number, target: string): Promise<GroupRecord> {
  const record: GroupRecord = {
    group: mail.group,
    students: mail.students,
    submittedAt: mail.date.toISOString(),
    subject: mail.subject,
    from: mail.from,
    viewUrl: mail.viewUrl,
    zipUrl: mail.zipUrl,
    zipSource: null,
    violations: protocolViolations({ ...mail, exercise, hasZipAttachment: !!mail.zipAttachment }),
    earlier: [],
  };

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
