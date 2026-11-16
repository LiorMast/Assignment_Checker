import { spawnSync } from 'node:child_process';
import { exercises } from '../exercises/registry';
import { loadEdits } from './edits';
import { findGroup } from './mail-parse';
import { ROOT } from './paths';
import { prepare } from './prepare';

const USAGE = `Usage: npm run grade -- <exercise> [--student <id> | --group <cgroupXX>] [Playwright options, e.g. --workers=4]

  exercises: ${Object.keys(exercises).join(', ')}

  npm run grade -- ex1                       grade everyone in submissions/ex1/
  npm run grade -- ex1 --student 206352221   re-grade one student, keep the others
  npm run grade -- ex1 --group cgroup12      re-grade one group (zips collected by npm run fetch)
  npm run grade -- ex1 --offline             don't open the mailed view links on proj.ruppin.ac.il`;

async function main(): Promise<number> {
  const [exercise, ...rest] = process.argv.slice(2);
  if (!exercise || !exercises[exercise]) {
    console.error(USAGE);
    return 1;
  }
  const offlineAt = rest.indexOf('--offline');
  if (offlineAt >= 0) rest.splice(offlineAt, 1);
  const flag = rest.findIndex((arg) => arg === '--student' || arg === '--group');
  const [option, value] = flag >= 0 ? rest.splice(flag, 2) : [];
  // Group names are normalized like the zip names: "--group 7" and "cgroup7" both mean cgroup07.
  const student = value && (findGroup(value) ?? (option === '--group' ? findGroup(`cgroup${value}`) : undefined) ?? value);
  if (flag >= 0 && !student) {
    console.error(USAGE);
    return 1;
  }

  // A broken edits file would only fail when the reports are written, after the whole run.
  loadEdits(exercise);
  const { submissions, warnings } = await prepare(exercise);
  console.log(`Prepared ${submissions.length} submission(s) from submissions/${exercise}/`);
  for (const warning of warnings) console.warn(`  ! ${warning}`);
  if (!submissions.length) {
    console.error(`Nothing to grade: run "npm run fetch -- ${exercise}", or put one zip or folder per student in submissions/${exercise}/`);
    return 1;
  }
  if (student && !submissions.some((s) => s.id === student)) {
    console.error(`No submission with ID ${student}`);
    return 1;
  }

  const grep = student ? ['--grep', `${student.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`] : [];
  const run = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', `--project=${exercise}`, ...grep, ...rest], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, GRADER_EXERCISE: exercise, GRADER_PARTIAL: student ? '1' : '', ...(offlineAt >= 0 ? { GRADER_OFFLINE: '1' } : {}) },
  });
  // Every deduction is a failed test, so exit code 1 is the normal outcome of a grading run.
  return run.status === 0 || run.status === 1 ? 0 : (run.status ?? 1);
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
