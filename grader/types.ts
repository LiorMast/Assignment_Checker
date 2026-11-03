/** One student's submission after `prepare` (stored in .work/<exercise>/manifest.json). */
export interface Submission {
  /** Student ID taken from the file/folder name (or a cleaned-up name when there is none). */
  id: string;
  /** Original file or folder name under submissions/<exercise>/. */
  source: string;
  /** Absolute path of the extracted submission; served as the web root. */
  rootDir?: string;
  /** Entry HTML file, relative to rootDir, with forward slashes. */
  entry?: string;
  /** Set when the submission cannot be graded automatically (shown to the grader). */
  error?: string;
  /** Group name (e.g. cgroup12) when the submission came from `npm run fetch`. */
  group?: string;
  /** Student IDs of the group, taken from the submission mail. */
  students?: string[];
}

/** A comment from the exercise's comments table that applies to a student. */
export interface Flag {
  key: string;
  no: number;
  text: string;
  /** Points actually deducted (0 = note only). */
  points: number;
  /** What exactly was found, e.g. which box or which file. */
  detail?: string;
}

export interface StudentResult {
  id: string;
  source?: string;
  /** false = could not be graded automatically; the grade is left empty. */
  graded: boolean;
  flags: Flag[];
  /** Reasons for the grader to look at this submission. Never deducted. */
  review: string[];
  /** Screenshot file name under results/<exercise>/screenshots/. */
  screenshot?: string;
  /** Group submissions: graded once, written to grades.xlsx once per student ID. */
  group?: string;
  students?: string[];
}

/** One group's submission as collected by `npm run fetch` (submissions/<exercise>/.groups.json). */
export interface GroupRecord {
  group: string;
  /** Student IDs from the subject (or the body when the subject has none). */
  students: string[];
  /** ISO date of the mail that was used (the latest one from this group). */
  submittedAt: string;
  subject: string;
  from: string;
  viewUrl?: string;
  zipUrl?: string;
  /** Where cgroupNN.zip came from; null when no zip could be saved. */
  zipSource: 'link' | 'attachment' | 'previous' | null;
  /** Why the zip could not be downloaded from the link (or at all). */
  error?: string;
  late?: boolean;
  /** Deviations from the submission procedure (Hebrew, for the report). */
  violations: string[];
  /** Earlier mails from the same group, which were not used. */
  earlier: { date: string; subject: string; zipUrl?: string }[];
}
