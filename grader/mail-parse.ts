/**
 * Pure helpers for reading submission mails (no network, no IMAP), so they can be tested on
 * sample subjects and bodies. Rules follow "נוהל הגשת תרגילי בית":
 *   subject: cgroupXX tarN name1 - ID1, name2 - ID2
 *   body:    proj.ruppin.ac.il/cgroupXX/test1/tarN/index.html
 *            proj.ruppin.ac.il/cgroupXX/test1/tarN/tarN.zip
 */

export const SERVER_HOST = 'proj.ruppin.ac.il';

const GROUP_RE = /c[\s_-]?group[\s_-]*0*(\d{1,3})/i;
/** "tar1", "ex 1", "ex_01", "exercise1", "targil 1", "תרגיל 1", "בתרגיל 1", "מטלה 1". */
const EXERCISE_RE = /(?:(?<![a-z])(?:tar|targil|exercise|ex)|תרגיל|מטלה)[\s_.\-#]*0*(\d{1,2})(?!\d)/i;
const ID_RE = /(?<!\d)\d{8,9}(?!\d)/g;

/** cgroupNN (at least two digits), or undefined when the text has no group. */
export function findGroup(text: string): string | undefined {
  const match = text.match(GROUP_RE);
  return match ? `cgroup${match[1].padStart(2, '0')}` : undefined;
}

/** Any letter before "group" (bgroup60, X-group 60): students mistype the "c". */
const LOOSE_GROUP_RE = /(?<![a-z])[a-z][\s_-]?group[\s_-]*0*(\d{1,3})(?!\d)/gi;

/**
 * The group in a mail subject: an exact cgroupNN, or else a mistyped prefix (bgroup60) corrected
 * to cgroupNN when that group is one of the course's groups (exercises/groups.txt).
 */
export function findCourseGroup(text: string, known: Set<string>): string | undefined {
  const exact = findGroup(text);
  if (exact) return exact;
  for (const match of text.matchAll(LOOSE_GROUP_RE)) {
    const group = `cgroup${match[1].padStart(2, '0')}`;
    if (known.has(group)) return group;
  }
  return undefined;
}

export function findExercise(text: string): number | undefined {
  const match = text.match(EXERCISE_RE);
  return match ? Number(match[1]) : undefined;
}

export function findStudentIds(text: string): string[] {
  return [...new Set(text.match(ID_RE) ?? [])];
}

/**
 * A server link whose folder or file names contain spaces, e.g.
 * "proj.ruppin.ac.il/cgroup53/test1/tar1/322882689 318979994/322882689 318979994.zip".
 * Mail clients make only the part before the first space clickable, so the link is read from the text:
 * on one line, up to the first .zip/.html, without Hebrew and without another http:// inside.
 */
const SPACED_SERVER_LINK =
  /(?:https?:\/\/|(?<![\w./@-]))proj\.ruppin\.ac\.il\/(?:(?!https?:\/\/)(?:[^\s<>"'\u0590-\u05ff\u200e\u200f]| (?! *[-–—:|]))){1,300}?\.(?:zip|html?)(?![\w])/gi;

/** Every link in the mail: http(s) URLs and bare "proj.ruppin.ac.il/..." text, from text and HTML. */
export function extractLinks(text: string, html = ''): string[] {
  const found: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) found.push(decodeEntities(m[1]));
  // Inline tags are removed without a space so a link split across <a>/<span> stays in one piece.
  const htmlText = html.replace(/<(?:br|\/?(?:p|div|li|tr|td|h\d|ul|ol|table|blockquote))\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, '');
  const plain = decodeEntities(`${text}\n${htmlText}`).replace(/\u00a0/g, ' ');
  for (const m of plain.matchAll(/(?:https?:\/\/|(?<![\w./@-])proj\.ruppin\.ac\.il\/)[^\s<>"'\u200e\u200f]+/gi)) found.push(m[0]);
  for (const m of plain.matchAll(SPACED_SERVER_LINK)) found.push(m[0]);

  const links = new Set<string>();
  for (const raw of found) {
    const url = normalizeUrl(raw);
    if (url) links.add(url);
  }
  // Drop the clickable stub of a link with spaces (".../tar1/322882689" of ".../tar1/322882689 318979994/...zip").
  return [...links].filter((a) => ![...links].some((b) => b !== a && b.startsWith(a) && b.slice(a.length).startsWith('%20')));
}

function decodeEntities(text: string): string {
  return text.replace(/&nbsp;/gi, ' ').replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/');
}

function normalizeUrl(raw: string): string | undefined {
  let link = raw.trim().replace(/[.,;:!?)\]}>'"]+$/, '');
  if (/^mailto:/i.test(link)) return undefined;
  if (!/^https?:\/\//i.test(link)) link = `http://${link}`;
  try {
    const url = new URL(link);
    return url.hostname.includes('.') ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Decoded path, with doubled slashes collapsed (proj.ruppin.ac.il//cgroup68/... opens the same page). */
const pathOf = (url: string) => {
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/\/{2,}/g, '/');
  } catch {
    return url;
  }
};
const hostOf = (url: string) => new URL(url).hostname.toLowerCase();

const FILE_HOSTS = /(^|\.)(drive\.google|docs\.google|dropbox|wetransfer|we\.tl|onedrive\.live|1drv\.ms|sharepoint|github|mega\.nz)\./i;

/** The zip link and the browsing link, as described in the procedure, plus links to file-sharing services. */
export function classifyLinks(links: string[]): { zipUrl?: string; viewUrl?: string; externalUrls: string[] } {
  const zipUrl = links.find((l) => /\.zip$/i.test(pathOf(l)));
  const others = links.filter((l) => l !== zipUrl);
  const viewUrl = others.find((l) => /\.html?$/i.test(pathOf(l))) ?? others.find((l) => hostOf(l) === SERVER_HOST);
  const externalUrls = links.filter((l) => l !== zipUrl && l !== viewUrl && FILE_HOSTS.test(`.${hostOf(l)}`));
  return { zipUrl, viewUrl, externalUrls };
}

/**
 * The exercise number the mail claims: from the subject (tarN), else from the links' folder names.
 * The fetcher combines it with the mail date (`resolveExercise` in schedule.ts).
 */
export function exerciseHint(subject: string, links: { zipUrl?: string; viewUrl?: string }): number | undefined {
  const fromSubject = findExercise(subject);
  if (fromSubject !== undefined) return fromSubject;
  for (const url of [links.zipUrl, links.viewUrl]) {
    if (!url) continue;
    const n = findExercise(pathOf(url));
    if (n !== undefined) return n;
  }
  return undefined;
}

/**
 * The group whose folder a server link points into: the first folder of the path, with any letter
 * before "group" (/cgroup51/test1/..., /bgroup55/test1/... → cgroup55). The zip was uploaded with
 * that group's account, so the submission is that group's.
 */
export function linkGroup(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    if (hostOf(url) !== SERVER_HOST) return undefined;
  } catch {
    return undefined;
  }
  const match = (pathOf(url).split('/')[1] ?? '').match(/^[a-z]{0,2}[\s_-]?group[\s_-]*0*(\d{1,3})$/i);
  return match ? `cgroup${match[1].padStart(2, '0')}` : undefined;
}

/** A link to the course server (where submissions are uploaded). */
export function isServerUrl(url: string | undefined): boolean {
  try {
    return !!url && hostOf(url) === SERVER_HOST;
  } catch {
    return false;
  }
}

/** How a mail's group was decided, in order of trust. */
export type GroupSource = 'by-hand' | 'link' | 'sender' | 'ids' | 'subject';

const SOURCE_LABEL: Record<GroupSource, string> = {
  'by-hand': 'שיוך ידני (mail-groups.json)',
  link: 'התיקייה בלינק',
  sender: 'כתובת השולח ברשימת הקבוצות',
  ids: 'ת"ז במייל ברשימת הקבוצות',
  subject: 'נושא המייל',
};

/** What `assignGroup` needs from the roster (grader/roster.ts). */
export interface RosterIndex {
  groups: Map<string, unknown>;
  byId: Map<string, string>;
  byEmail: Map<string, string>;
}

export interface GroupAssignment {
  group?: string;
  by?: GroupSource;
  /** Other sources that point to a different group (Hebrew, for the grader). */
  conflicts: string[];
}

/**
 * Which group a mail belongs to, from the most trusted source that names one:
 * a hand assignment by sender, the group folder in the zip link (then the view link), the sender's
 * email in the roster, the student IDs in the mail (when they all belong to one roster group), and
 * last the group written in the subject (a mistyped prefix is corrected for known groups).
 */
export function assignGroup(
  m: { subject: string; fromAddress: string; zipUrl?: string; viewUrl?: string; ids: string[] },
  roster?: RosterIndex,
  byHand: Map<string, string> = new Map(),
  /** Groups a mistyped subject prefix may be corrected to (default: the roster's). */
  known: Set<string> = new Set(roster?.groups.keys()),
): GroupAssignment {
  const inRoster = (g: string | undefined) => !!g && (!roster || roster.groups.has(g));
  const idGroups = roster ? [...new Set(m.ids.map((id) => roster.byId.get(id)).filter((g): g is string => !!g))] : [];
  const candidates: [GroupSource, string | undefined][] = [
    ['by-hand', byHand.get(m.fromAddress)],
    ['link', [m.zipUrl, m.viewUrl].map(linkGroup).find(inRoster)],
    ['sender', roster?.byEmail.get(m.fromAddress)],
    ['ids', idGroups.length === 1 ? idGroups[0] : undefined],
    ['subject', findCourseGroup(m.subject, known)],
  ];
  const found = candidates.filter((c): c is [GroupSource, string] => !!c[1]);
  if (!found.length) return { conflicts: [] };
  const [by, group] = found[0];
  const conflicts = found
    .filter(([, g]) => g !== group)
    .map(([source, g]) => `שויך ל-${group} לפי ${SOURCE_LABEL[by]}; לפי ${SOURCE_LABEL[source]}: ${g}`);
  return { group, by, conflicts };
}

export interface MailFacts {
  subject: string;
  group: string;
  exercise: number;
  zipUrl?: string;
  viewUrl?: string;
  /** IDs found in the subject (not the body). */
  subjectIds: string[];
  hasZipAttachment: boolean;
  externalUrls?: string[];
}

/**
 * What the subject is missing, per the procedure: "bgroup55 tar1 name1 - 123456789, name2 – 987654321".
 * Punctuation is free; the group (any letter before "group", the right number), tarN (the right
 * exercise), the IDs and a name next to each ID must be there. Empty when the subject is fine.
 */
export function titleProblems(subject: string, group: string, exercise: number): string[] {
  const groupNo = Number(group.replace(/^cgroup/, ''));
  const groupRe = new RegExp(`(?<![a-z])[a-z][\\s_-]?group[\\s_-]*0*${groupNo}(?!\\d)`, 'gi');
  const tarRe = new RegExp(`(?<![a-z])tar[\\s_-]*0*${exercise}(?!\\d)`, 'gi');
  const missing: string[] = [];
  if (subject.search(groupRe) < 0) missing.push(`שם הקבוצה (${group})`);
  if (subject.search(tarRe) < 0) missing.push(`שם התרגיל (tar${exercise})`);

  // Names: each ID needs a word (2+ letters) right before it or right after it.
  const rest = subject.replace(groupRe, ' ').replace(tarRe, ' ');
  const ids = [...rest.matchAll(new RegExp(ID_RE.source, 'g'))];
  if (!ids.length) missing.push('ת"ז ושמות הסטודנטים');
  const hasName = (text: string) => /\p{L}{2,}/u.test(text);
  ids.forEach((id, i) => {
    const before = rest.slice(i ? ids[i - 1].index! + ids[i - 1][0].length : 0, id.index);
    const after = rest.slice(id.index! + id[0].length, i + 1 < ids.length ? ids[i + 1].index : undefined);
    if (!hasName(before) && !hasName(after)) missing.push(`שם הסטודנט עם ת"ז ${id[0]}`);
  });
  return missing.length ? [`נושא המייל אינו לפי הנוהל – חסר: ${missing.join(', ')}`] : [];
}

/**
 * What is wrong with the two links, per the procedure: both on proj.ruppin.ac.il under
 * /<group>/test1/tarN/ (subfolders below it are allowed), the view link to index.html, no spaces.
 */
export function linkProblems(m: { group: string; exercise: number; viewUrl?: string; zipUrl?: string }): string[] {
  const out: string[] = [];
  if (!m.viewUrl) out.push('חסר לינק לצפייה בפרויקט (index.html)');
  if (!m.zipUrl) out.push('חסר לינק להורדת קובץ ה-zip');
  const expected = `/${m.group}/test1/tar${m.exercise}/`;
  for (const [label, url] of [
    ['הצפייה', m.viewUrl],
    ['ה-zip', m.zipUrl],
  ] as const) {
    if (!url) continue;
    if (hostOf(url) !== SERVER_HOST) {
      out.push(`לינק ${label} אינו בשרת ${SERVER_HOST}: ${url}`);
      continue;
    }
    if (new URL(url).pathname.includes('//')) out.push(`בלינק ${label} יש // כפול: ${url}`);
    const linkGroup = findGroup(pathOf(url).split('/')[1] ?? '');
    if (linkGroup && linkGroup !== m.group) out.push(`הקבוצה בלינק ${label} (${linkGroup}) שונה מהקבוצה בנושא (${m.group})`);
    else if (!normalizedPath(url).startsWith(expected)) out.push(`לינק ${label} אינו במבנה ${expected}: ${url}`);
  }
  if ([m.viewUrl, m.zipUrl].some((url) => url && hostOf(url) === SERVER_HOST && url.includes('%20'))) {
    out.push('יש רווחים בשמות התיקיות/הקבצים בלינק, ולכן הלינק אינו לחיץ במלואו');
  }
  if (m.viewUrl && hostOf(m.viewUrl) === SERVER_HOST && !/\/index\.html?$/i.test(pathOf(m.viewUrl))) {
    out.push('לינק הצפייה אינו מצביע לדף index.html');
  }
  return out;
}

/** Everything in the mail that doesn't follow the procedure (download problems and lateness are added by the fetcher). */
export function protocolViolations(m: MailFacts): string[] {
  const out = titleProblems(m.subject, m.group, m.exercise);
  out.push(...linkProblems(m));
  if (!m.zipUrl && m.hasZipAttachment) out.push('קובץ ה-zip צורף למייל במקום לינק להורדה');
  else if (m.zipUrl && m.hasZipAttachment) out.push('צורף קובץ zip למייל בנוסף ללינק');
  for (const url of m.externalUrls ?? []) out.push(`נשלח לינק לשירות חיצוני במקום לשרת ${SERVER_HOST}: ${url}`);
  return out;
}

/** Lower-case path with the group's number padded, so /CGroup5/Test1/ compares equal to /cgroup05/test1/. */
function normalizedPath(url: string): string {
  const parts = pathOf(url).toLowerCase().split('/');
  parts[1] = findGroup(parts[1] ?? '') ?? parts[1];
  parts[3] = (parts[3] ?? '').replace(/^tar0*(\d+)$/, 'tar$1');
  return parts.join('/');
}

/**
 * The moment from which a mail is late (exclusive cut-off), Israel time.
 * A date alone means the whole day counts: "2026-11-04" → late from 05.11 00:00.
 * With a time, that whole minute still counts: "2026-11-04 18:00" → late from 18:01.
 */
export function parseDeadline(text: string): Date {
  const day = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!day) return new Date(parseIsraelTime(text).getTime() + 60_000);
  const next = new Date(Date.UTC(+day[1], +day[2] - 1, +day[3] + 1)).toISOString().slice(0, 10);
  return parseIsraelTime(`${next} 00:00`);
}

/** "YYYY-MM-DD HH:mm" (or just the date, meaning 23:59) in Israel time → Date. */
export function parseIsraelTime(text: string): Date {
  const m = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (!m) throw new Error(`Bad date "${text}", expected YYYY-MM-DD or "YYYY-MM-DD HH:mm"`);
  const [y, mo, d, h = '23', mi = '59'] = m.slice(1);
  const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, m[4] ? 0 : 59);
  // Shift by Israel's UTC offset at that moment (handles summer time).
  const offset = (at: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        .formatToParts(at)
        .map((p) => [p.type, p.value]),
    );
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - at;
  };
  return new Date(asUtc - offset(asUtc - offset(asUtc)));
}

export function formatIsraelTime(date: Date | string): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(date));
}
