import type { Comment } from '../grader/comments';
import { PROTOCOL_C } from '../grader/protocol-comments';
import { COMMENTS_VERSION as ex1Version, C as ex1 } from './ex1/comments';
import { COMMENTS_VERSION as ex2Version, C as ex2 } from './ex2/comments';

export interface ExerciseInfo {
  /** The exercise's folder name and command-line name, e.g. ex1. */
  key: string;
  title: string;
  /** Sheet name and grade column header, as in the course's grades workbook. */
  sheetName: string;
  gradeHeader: string;
  comments: Record<string, Comment>;
  /** Version of the comments table (exercises/<ex>/comments/vN.ts), shown in grades.xlsx and summary.html. */
  commentsVersion: number;
}

/** Adds the submission-procedure comments (101+), which apply to every exercise. */
const defineExercise = (key: string, info: Omit<ExerciseInfo, 'key'>): ExerciseInfo => ({ key, ...info, comments: { ...info.comments, ...PROTOCOL_C } });

/** Every gradable exercise. Each one also needs a project in playwright.config.ts. */
export const exercises: Record<string, ExerciseInfo> = {
  ex1: defineExercise('ex1', {
    title: 'תרגיל 1 – בניית דף מידע על שפות לפיתוח אתרים',
    sheetName: 'ציוני מטלה 1',
    gradeHeader: 'ציון מטלה 1',
    comments: ex1,
    commentsVersion: ex1Version,
  }),
  ex2: defineExercise('ex2', {
    title: 'תרגיל 2 – התאמת הדף באמצעות Bootstrap',
    sheetName: 'ציוני מטלה 2',
    gradeHeader: 'ציון מטלה 2',
    comments: ex2,
    commentsVersion: ex2Version,
  }),
};
