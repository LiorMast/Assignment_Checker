import fs from 'node:fs';
import path from 'node:path';
import { exercises } from '../exercises/registry';
import { printSummary, writeOutputs } from './output';
import { resultsDir } from './paths';
import type { StudentResult } from './types';

const USAGE = `Usage: npm run report -- <exercise>

  Rewrites grades.xlsx, students.xlsx, summary.html and feedback/ from the last grading run
  (results/<exercise>/results.json) with the hand edits in manual-submissions/<exercise>/grade-edits.json,
  without grading again.

  exercises: ${Object.keys(exercises).join(', ')}`;

async function main(): Promise<number> {
  const [key] = process.argv.slice(2);
  const exercise = key ? exercises[key] : undefined;
  if (!exercise) {
    console.error(USAGE);
    return 1;
  }
  const dir = resultsDir(key);
  const file = path.join(dir, 'results.json');
  if (!fs.existsSync(file)) {
    console.error(`No ${path.relative(process.cwd(), file)}: run "npm run grade -- ${key}" first`);
    return 1;
  }
  const results = JSON.parse(fs.readFileSync(file, 'utf8')) as StudentResult[];
  printSummary(dir, await writeOutputs(dir, exercise, results));
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
