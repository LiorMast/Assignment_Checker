import { defineComments, type CommentDef } from './comments';

/**
 * Submission-procedure comments (נוהל הגשת תרגילי בית), shared by every exercise.
 * Numbered from 101 so they have the same number in every exercise and never collide with an
 * exercise's own table (1, 2, ...). The registry adds them to every exercise's comments and
 * `defineGradeSpec` runs their checks (grader/protocol.ts) for every submission.
 * APPEND-ONLY once grades were given: never reorder or remove (numbers come from the order);
 * a changed rule gets a new key at the end, and the old one stops being given.
 */
export const PROTOCOL_DEFS = {
  // Retired 2026-11-15: the mail subject is not graded (kept so the numbers below stay the same).
  SUBMIT_TITLE: { text: 'בוטלה – נושא המייל אינו נבדק', points: 0 },
  SUBMIT_LINKS: {
    text: 'נוהל הגשה: הלינקים במייל אינם לפי הנוהל – נדרשים לינק לצפייה proj.ruppin.ac.il/<קבוצה>/test1/tarX/index.html ולינק ל-zip באותה תיקייה',
    points: 5,
  },
  LIVE_NOT_OPEN: { text: 'נוהל הגשה: הלינק לצפייה בפרויקט אינו נפתח בשרת', points: 10 },
  LIVE_RESOURCES: {
    text: 'נוהל הגשה: הדף בשרת נפתח, אך חלק מהקבצים (עיצוב/תמונות/סקריפטים) לא נטענים בשרת – קבצים שלא הועלו או שמות באותיות גדולות/קטנות שונות',
    points: 3,
  },
  UNRELATED_FILES: { text: 'נוהל הגשה: בהגשה נכללו קבצים שאינם קשורים לתרגיל – יש להגיש רק את קבצי הפרויקט', points: 3 },
} satisfies Record<string, CommentDef>;

export const PROTOCOL_C = defineComments(PROTOCOL_DEFS, 101);
export type ProtocolKey = keyof typeof PROTOCOL_DEFS;
