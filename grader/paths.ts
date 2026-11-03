import path from 'node:path';

/** Project root (the folder that holds package.json). */
export const ROOT = path.resolve(__dirname, '..');

/** Input: one zip or folder per student, named with the student's ID. */
export const submissionsDir = (exercise: string) => path.join(ROOT, 'submissions', exercise);

/** Extracted copies of the submissions, rebuilt on every run. */
export const workDir = (exercise: string) => path.join(ROOT, '.work', exercise);

export const manifestPath = (exercise: string) => path.join(workDir(exercise), 'manifest.json');

/** Output: grades.xlsx, results.json, feedback/, screenshots/, summary.html. */
export const resultsDir = (exercise: string) => path.join(ROOT, 'results', exercise);

/** Written by `npm run fetch`: each group's mail details, read by `prepare` (dot file, so it isn't a submission). */
export const groupsFile = (exercise: string) => path.join(submissionsDir(exercise), '.groups.json');
