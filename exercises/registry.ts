import type { Comment } from '../grader/comments';
import { C as ex1 } from './ex1/comments';

export interface ExerciseInfo {
  title: string;
  /** Sheet name and grade column header, as in the course's grades workbook. */
  sheetName: string;
  gradeHeader: string;
  comments: Record<string, Comment>;
}

/** Every gradable exercise. Each one also needs a project in playwright.config.ts. */
export const exercises: Record<string, ExerciseInfo> = {
  ex1: {
    title: 'תרגיל 1 – בניית דף מידע על שפות לפיתוח אתרים',
    sheetName: 'ציוני מטלה 1',
    gradeHeader: 'ציון מטלה 1',
    comments: ex1,
  },
};
