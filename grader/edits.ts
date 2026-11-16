import fs from 'node:fs';
import path from 'node:path';
import type { Comment } from './comments';
import { editsFile, ROOT } from './paths';
import type { Flag, StudentResult } from './types';

/**
 * Hand edits of the grader, made in grades-viewer.html and saved as
 * manual-submissions/<exercise>/grade-edits.json. They are a layer on top of the automatic
 * results (results.json is never changed), applied whenever the reports are written.
 * grades-viewer.html applies the same rules in the browser; a self-test compares the two.
 */
export interface GradeEdits {
  version: 1;
  /** By comment number: text/points overrides of the exercise's comments, and hand-added comments (201+). */
  comments?: Record<string, CommentEdit>;
  /** By group name (or student ID for a submission without a group). */
  groups?: Record<string, GroupEdits>;
}

export interface CommentEdit {
  text?: string;
  points?: number;
}

export interface GroupEdits {
  /** By comment number: null = the comment does not apply; an object = it applies, with these values. */
  flags?: Record<string, FlagEdit | null>;
  /** A grade typed by hand; it no longer follows the deductions. */
  grade?: number;
  /** An ungraded submission gets its grade from its comments. */
  graded?: boolean;
  /** Manual-review reasons the grader settled, by text (a new reason after a re-grade still shows). */
  dismissed?: string[];
  /** Manual-review reasons added by the grader. */
  notes?: string[];
  /** The grader marked the group as checked (a status: it changes nothing in the grade). */
  checked?: boolean;
}

export interface FlagEdit {
  points?: number;
  detail?: string;
}

/** Hand-added comments are numbered from here: above the exercise table (1+) and the procedure table (101+). */
export const FIRST_MANUAL_NO = 201;

/** The exercise's hand edits; undefined when there are none. Throws on a file that can't be used. */
export function loadEdits(exercise: string): GradeEdits | undefined {
  const file = editsFile(exercise);
  if (!fs.existsSync(file)) return undefined;
  const name = path.relative(ROOT, file);
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (error) {
    throw new Error(`${name} is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  const problem = editsProblem(data);
  if (problem) throw new Error(`${name}: ${problem}`);
  return data as GradeEdits;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isPoints = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isTexts = (value: unknown) => Array.isArray(value) && value.every((v) => typeof v === 'string');

/** What is wrong with an edits file's content; undefined when it is valid. */
export function editsProblem(data: unknown): string | undefined {
  if (!isObject(data)) return 'expected an object';
  if (data.version !== 1) return `unsupported version ${JSON.stringify(data.version)} (expected 1)`;
  const { comments = {}, groups = {} } = data;
  if (!isObject(comments)) return '"comments" must be an object';
  if (!isObject(groups)) return '"groups" must be an object';
  for (const [no, c] of Object.entries(comments)) {
    const at = `comments.${no}`;
    if (!/^\d+$/.test(no)) return `${at}: the key must be a comment number`;
    if (!isObject(c)) return `${at} must be an object`;
    if (c.text !== undefined && typeof c.text !== 'string') return `${at}.text must be a string`;
    if (c.points !== undefined && !isPoints(c.points)) return `${at}.points must be a number, 0 or more`;
  }
  for (const [group, g] of Object.entries(groups)) {
    const at = `groups.${group}`;
    if (!isObject(g)) return `${at} must be an object`;
    if (g.grade !== undefined && !(isPoints(g.grade) && (g.grade as number) <= 100)) return `${at}.grade must be a number from 0 to 100`;
    if (g.graded !== undefined && typeof g.graded !== 'boolean') return `${at}.graded must be true or false`;
    if (g.checked !== undefined && typeof g.checked !== 'boolean') return `${at}.checked must be true or false`;
    if (g.dismissed !== undefined && !isTexts(g.dismissed)) return `${at}.dismissed must be a list of strings`;
    if (g.notes !== undefined && !isTexts(g.notes)) return `${at}.notes must be a list of strings`;
    if (g.flags === undefined) continue;
    if (!isObject(g.flags)) return `${at}.flags must be an object`;
    for (const [no, f] of Object.entries(g.flags)) {
      if (!/^\d+$/.test(no)) return `${at}.flags.${no}: the key must be a comment number`;
      if (f === null) continue;
      if (!isObject(f)) return `${at}.flags.${no} must be null or an object`;
      if (f.points !== undefined && !isPoints(f.points)) return `${at}.flags.${no}.points must be a number, 0 or more`;
      if (f.detail !== undefined && typeof f.detail !== 'string') return `${at}.flags.${no}.detail must be a string`;
    }
  }
  return undefined;
}

const hasEdits = (g: GroupEdits | undefined) =>
  !!g && (Object.keys(g.flags ?? {}).length > 0 || g.grade !== undefined || !!g.graded || !!g.dismissed?.length || !!g.notes?.length);

export interface AppliedEdits {
  /** The results with the hand edits; the automatic results are not changed. */
  results: StudentResult[];
  /** The comments table with the overrides and the hand-added comments (at the end). */
  comments: Record<string, Comment>;
  /** Edits that could not be applied (English, for the console). */
  warnings: string[];
}

/** The comments table after the hand edits: text/points overrides, and new comments appended by number. */
function editedComments(comments: Record<string, Comment>, edits: GradeEdits, warnings: string[]): Record<string, Comment> {
  const keyOf = new Map(Object.values(comments).map((c) => [c.no, c.key]));
  const table: Record<string, Comment> = {};
  for (const [key, c] of Object.entries(comments)) {
    const edit = edits.comments?.[c.no];
    if (edit?.points !== undefined && c.perUnit) warnings.push(`comment ${c.no} is per unit: its points can't be changed for everyone (change them per group)`);
    table[key] = { ...c, text: edit?.text ?? c.text, points: c.perUnit ? c.points : (edit?.points ?? c.points) };
  }
  const added = Object.keys(edits.comments ?? {}).map(Number).filter((no) => !keyOf.has(no));
  for (const no of added.sort((a, b) => a - b)) {
    const edit = edits.comments![no];
    if (!edit.text) warnings.push(`hand-added comment ${no} has no text`);
    table[`MANUAL_${no}`] = { key: `MANUAL_${no}`, no, text: edit.text ?? '', points: edit.points ?? 0 };
  }
  return table;
}

/** Applies the grader's hand edits to the automatic results. Pure: nothing is read or changed. */
export function applyEdits(results: StudentResult[], comments: Record<string, Comment>, edits?: GradeEdits): AppliedEdits {
  if (!edits) return { results, comments, warnings: [] };
  const warnings: string[] = [];
  const table = editedComments(comments, edits, warnings);
  const byNo = new Map(Object.values(table).map((c) => [c.no, c]));
  const names = new Set(results.map((r) => r.group ?? r.id));
  for (const name of Object.keys(edits.groups ?? {})) {
    if (!names.has(name)) warnings.push(`hand edits for ${name}, which has no result`);
  }

  const edited = results.map((r): StudentResult => {
    const name = r.group ?? r.id;
    const g = edits.groups?.[name];
    const flags: Flag[] = [];
    for (const flag of r.flags) {
      const edit = g?.flags?.[flag.no];
      if (edit === null) continue;
      const comment = byNo.get(flag.no);
      // A table-wide points change reaches every group that has no own value (never per-unit comments).
      const tablePoints = comment && !comment.perUnit ? edits.comments?.[flag.no]?.points : undefined;
      const detail = edit?.detail ?? flag.detail;
      flags.push({ ...flag, text: comment?.text ?? flag.text, points: edit?.points ?? tablePoints ?? flag.points, detail: detail || undefined });
    }
    const automatic = new Set(r.flags.map((f) => f.no));
    const added = Object.keys(g?.flags ?? {}).map(Number).filter((no) => g!.flags![no] !== null && !automatic.has(no));
    for (const no of added.sort((a, b) => a - b)) {
      const comment = byNo.get(no);
      const edit = g!.flags![no]!;
      if (!comment) {
        warnings.push(`${name}: comment ${no} is not in the comments table`);
        continue;
      }
      flags.push({ key: comment.key, no, text: comment.text, points: edit.points ?? comment.points, detail: edit.detail || undefined });
    }
    const review = [...r.review.filter((reason) => !g?.dismissed?.includes(reason)), ...(g?.notes ?? [])];
    return {
      ...r,
      graded: r.graded || !!g?.graded || g?.grade !== undefined,
      flags,
      review,
      ...(g?.grade !== undefined ? { manualGrade: g.grade } : {}),
      ...(hasEdits(g) ? { edited: true } : {}),
      ...(g?.checked ? { checked: true } : {}),
    };
  });
  return { results: edited, comments: table, warnings };
}
