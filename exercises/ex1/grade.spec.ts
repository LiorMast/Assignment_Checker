import { test } from '../../grader/fixtures';
import { loadManifest } from '../../grader/prepare';
import { gradeEx1 } from './checks';

// One test per student, generated from the manifest written by `npm run grade -- ex1`.
for (const submission of loadManifest('ex1')) {
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
        await gradeEx1(site, g);
        g.complete();
      });
    }
  });
}
