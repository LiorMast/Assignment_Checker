import { expect, test, type TestInfo } from '@playwright/test';
import { pointsFor, type Comment } from './comments';
import type { Flag, StudentResult, Submission } from './types';

export interface GraderOptions {
  /** Show deductions as failed soft assertions (red steps in the report). Off in the self-tests. */
  softAssert?: boolean;
}

/**
 * Collects one student's comments while the checks run.
 *
 * - `flag` records a comment from the table. Deductions fail the current step; 0-point
 *   comments become annotations.
 * - An unexpected error inside `check` becomes a manual-review reason, never a deduction.
 */
export class Grader {
  private readonly flags: Flag[] = [];
  private readonly reviews: string[] = [];
  private fatal = false;
  private done = false;

  constructor(
    private readonly info: TestInfo,
    private readonly options: GraderOptions = {},
  ) {}

  /** Groups checks in the report. */
  async section(title: string, body: () => Promise<void>) {
    await test.step(title, body);
  }

  /** One rubric check. */
  async check(title: string, body: () => Promise<void>) {
    await test.step(title, async () => {
      try {
        await body();
      } catch (error) {
        const message = firstLine(error);
        this.review(`הבדיקה "${title}" לא הושלמה: ${message}`);
        this.softFail(`שגיאה בבדיקה: ${message}`);
      }
    });
  }

  flag(comment: Comment, detail?: string, options: { times?: number } = {}) {
    if (this.has(comment)) return; // the same comment never costs points twice
    const points = pointsFor(comment, options.times);
    this.flags.push({ key: comment.key, no: comment.no, text: comment.text, points, ...(detail ? { detail } : {}) });
    const message = `(${comment.no}) ${comment.text}${detail ? ` — ${detail}` : ''}`;
    if (points > 0) this.softFail(`${message} [-${points}]`);
    else this.info.annotations.push({ type: `הערה ${comment.no}`, description: message });
  }

  /** Asks the grader to look at this submission. `fatal`: it could not be graded at all. */
  review(reason: string, options: { fatal?: boolean } = {}) {
    this.reviews.push(reason);
    this.fatal ||= !!options.fatal;
    this.info.annotations.push({ type: 'לבדיקה ידנית', description: reason });
  }

  has(comment: Comment): boolean {
    return this.flags.some((f) => f.key === comment.key);
  }

  /** Called after the last check; a run that never gets here is sent to manual review. */
  complete() {
    this.done = true;
  }

  get completed(): boolean {
    return this.done;
  }

  result(submission: Pick<Submission, 'id' | 'source'>): StudentResult {
    return {
      id: submission.id,
      source: submission.source,
      graded: !this.fatal,
      flags: [...this.flags].sort((a, b) => a.no - b.no),
      review: [...this.reviews],
    };
  }

  private softFail(message: string) {
    if (this.options.softAssert !== false) expect.soft(false, message).toBe(true);
  }
}

export function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split('\n')[0].replace(/\u001b\[[0-9;]*m/g, '').trim();
}
