import fs from 'node:fs';
import path from 'node:path';
import { findGroup } from './mail-parse';
import { ROOT } from './paths';

/** This semester's groups, one per line: the fallback when there is no groups.xlsx roster (grader/roster.ts). */
export const GROUPS_FILE = path.join(ROOT, 'exercises', 'groups.txt');

/** The course's groups as cgroupNN; empty (only exact "cgroup" subjects match) when the file is missing. */
export function loadCourseGroups(file = GROUPS_FILE): Set<string> {
  if (!fs.existsSync(file)) {
    console.warn(`  ! ${path.relative(ROOT, file)} not found: mistyped group names (bgroupNN) won't be corrected`);
    return new Set();
  }
  const groups = new Set<string>();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    const group = findGroup(text);
    if (group) groups.add(group);
    else console.warn(`  ! ${path.relative(ROOT, file)}: ignoring "${text}" (expected cgroupNN)`);
  }
  return groups;
}
