import type { FullConfig, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import fs from 'node:fs';
import path from 'node:path';
import { exercises } from '../exercises/registry';
import { firstLine } from './grader';
import { gradeOf, writeOutputs } from './output';
import { resultsDir } from './paths';
import { loadManifest } from './prepare';
import type { StudentResult } from './types';

/**
 * Turns the per-student test results into grades.xlsx, feedback files and summary.html.
 * Used for grading runs only (GRADER_EXERCISE is set by the CLI). Tests without a "student"
 * annotation are ignored.
 */
export default class GradeReporter implements Reporter {
  private readonly exercise = process.env.GRADER_EXERCISE ?? '';
  /** A --student run: merge into the previous results instead of replacing them. */
  private readonly partial = process.env.GRADER_PARTIAL === '1';
  private readonly results = new Map<string, StudentResult>();
  private readonly screenshots = new Map<string, string>();

  printsToStdio() {
    return true;
  }

  onBegin(_config: FullConfig, suite: Suite) {
    console.log(`\nGrading ${this.exercise}: ${suite.allTests().length} submission(s)\n`);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const id = test.annotations.find((a) => a.type === 'student')?.description;
    if (!id) return;
    const body = result.attachments.find((a) => a.name === 'grader-result')?.body;
    const student: StudentResult = body ? JSON.parse(body.toString('utf8')) : { id, graded: false, flags: [], review: [] };
    if (!body) {
      const why = result.error?.message ? firstLine(result.error.message) : result.status;
      student.review.push(`הבדיקה האוטומטית לא הושלמה: ${why}`);
    }
    const screenshot = result.attachments.find((a) => a.name === 'screenshot')?.path;
    if (screenshot) this.screenshots.set(id, screenshot);
    this.results.set(id, student);
    console.log(progressLine(student));
  }

  async onEnd() {
    const exercise = exercises[this.exercise];
    if (!exercise || !this.results.size) return;
    const dir = resultsDir(this.exercise);
    const screenshotsDir = path.join(dir, 'screenshots');
    if (!this.partial) {
      fs.rmSync(screenshotsDir, { recursive: true, force: true });
      fs.rmSync(path.join(dir, 'feedback'), { recursive: true, force: true });
    }
    fs.mkdirSync(screenshotsDir, { recursive: true });
    for (const [id, file] of this.screenshots) {
      if (!fs.existsSync(file)) continue;
      fs.copyFileSync(file, path.join(screenshotsDir, `${id}.jpg`));
      this.results.get(id)!.screenshot = `${id}.jpg`;
    }

    const merged = new Map<string, StudentResult>();
    const previous = path.join(dir, 'results.json');
    if (this.partial && fs.existsSync(previous)) {
      for (const r of JSON.parse(fs.readFileSync(previous, 'utf8')) as StudentResult[]) merged.set(r.id, r);
    }
    for (const [id, r] of this.results) merged.set(id, r);
    // Group submissions: the grade goes to every student of the group in grades.xlsx.
    for (const s of loadManifest(this.exercise)) {
      const r = merged.get(s.id);
      if (!r || !s.group) continue;
      Object.assign(r, { group: s.group, students: s.students ?? [] });
      if (!r.students!.length && !r.review.includes(NO_IDS)) r.review.push(NO_IDS);
    }
    const all = [...merged.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    await writeOutputs(dir, exercise, all);
    printSummary(dir, all);
  }
}

const NO_IDS = 'לא נמצאו מספרי ת"ז במייל ההגשה – יש להשלים ידנית ב-grades.xlsx';

function progressLine(r: StudentResult): string {
  const grade = gradeOf(r);
  const icon = r.review.length || !r.graded ? '!' : r.flags.some((f) => f.points > 0) ? '✘' : '✔';
  const numbers = r.flags.map((f) => f.no).join(',');
  return [
    `  ${icon} ${r.id.padEnd(12)}`,
    grade === undefined ? '  -' : String(grade).padStart(3),
    numbers && ` [${numbers}]`,
    r.review.length ? '  needs manual review' : '',
  ].join('');
}

function printSummary(dir: string, results: StudentResult[]) {
  const grades = results.map(gradeOf).filter((g): g is number => g !== undefined);
  const average = grades.length ? (grades.reduce((a, b) => a + b, 0) / grades.length).toFixed(1) : '-';
  const review = results.filter((r) => r.review.length || !r.graded).length;
  const rel = (p: string) => path.relative(process.cwd(), p);
  const groups = results.filter((r) => r.group).length;
  console.log(`\n${results.length} submission(s)${groups ? ` (${groups} group(s))` : ''} · average ${average} · ${review} need manual review`);
  console.log(`  ${rel(path.join(dir, 'grades.xlsx'))}`);
  console.log(`  ${rel(path.join(dir, 'summary.html'))}`);
  console.log(`  ${rel(path.join(dir, 'feedback'))}/<id>.txt\n`);
}
