import fs from 'node:fs';
import path from 'node:path';
import { parseDeadline, parseIsraelTime } from './mail-parse';
import { ROOT } from './paths';

/** One row of exercises/schedule.md. */
export interface ScheduleEntry {
  /** ex1, ex5a, ... */
  key: string;
  /** The number used in the mails (tar5 for both ex5a and ex5b). */
  number: number;
  title: string;
  /** Publish day, 00:00 Israel time. */
  publish: Date;
  /** Mails from this moment on are late: the day after the due date, 00:00 Israel time. */
  due: Date;
}

export const SCHEDULE_FILE = path.join(ROOT, 'exercises', 'schedule.md');

export const exerciseNumber = (key: string) => Number.parseInt(key.replace(/^ex/i, ''), 10);

/** Rows of the Markdown table whose second column is an exercise key. */
export function loadSchedule(file = SCHEDULE_FILE): ScheduleEntry[] {
  if (!fs.existsSync(file)) return [];
  const entries: ScheduleEntry[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 4 || !/^ex\d+[a-z]?$/i.test(cells[1])) continue;
    const [title, key, publish, due] = cells;
    entries.push({
      key: key.toLowerCase(),
      number: exerciseNumber(key),
      title,
      publish: parseIsraelTime(`${publish} 00:00`),
      due: parseDeadline(due),
    });
  }
  return entries;
}

/**
 * The exercise key a mail belongs to: among the entries with this number, the one published most
 * recently before the mail (so ex5b takes number-5 mails from its publish date on).
 */
export function exerciseKeyFor(schedule: ScheduleEntry[], number: number, date: Date): string {
  const parts = schedule.filter((e) => e.number === number).sort((a, b) => a.publish.getTime() - b.publish.getTime());
  if (!parts.length) return `ex${number}`;
  return (parts.filter((e) => e.publish <= date).pop() ?? parts[0]).key;
}
