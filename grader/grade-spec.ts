import { test, type Site } from './fixtures';
import type { Grader } from './grader';
import { loadManifest } from './prepare';
import { checkProtocol } from './protocol';

/**
 * Generates one test per submission in the manifest (written by `npm run grade -- <exercise>`).
 * Every exercise's grade.spec.ts is just `defineGradeSpec('exN', gradeExN)`: after the exercise's
 * own rubric, the submission-procedure checks (grader/protocol.ts) run for every submission.
 */
export function defineGradeSpec(exercise: string, gradeExercise: (site: Site, g: Grader) => Promise<void>) {
  for (const submission of loadManifest(exercise)) {
    test.describe(() => {
      test.use({ submission });
      const details = { annotation: { type: 'student', description: submission.id } };

      if (submission.error) {
        test(submission.id, details, async ({ g }) => {
          g.review(submission.error!, { fatal: true });
          g.complete();
        });
      } else {
        test(submission.id, details, async ({ g, site }) => {
          for (const note of submission.notes ?? []) g.review(note);
          await gradeExercise(site, g);
          await checkProtocol(site, g);
          g.complete();
        });
      }
    });
  }
}
