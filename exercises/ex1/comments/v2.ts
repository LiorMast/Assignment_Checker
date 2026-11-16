import { defineComments, type CommentDef } from '../../../grader/comments';
import { DEFS as V1 } from './v1';

/**
 * Exercise 1 comments table, version 2 (see CHANGELOG.md).
 * Built from v1: the spread keeps v1's order, so comments 1–50 keep their numbers;
 * changed comments are overridden in place and new comments are appended (51+).
 * Once grades are published with this version, freeze it and make v3.
 */
export const DEFS = {
  ...V1,
  MAIN_FILE_NAME: {
    text: 'קובץ הדף הראשי אינו נקרא index.html כנדרש – לכן הלינק לתיקייה בשרת אינו מציג את הדף',
    points: 2,
  },

  // חדש בגרסה 2
  REQUIRED_TEXTS: {
    text: 'הכותרות בדף שונות מהנדרש (שפות לפיתוח אתרים / לינקים שימושיים / גרסאות מתקדמות ולינק למידע / עוד שפות פופולריות)',
    points: 1,
  },
  EXTRA_FILES: { text: 'בהגשה נכללו קבצים שאינם חלק מהאתר – יש להגיש רק את קבצי הפרויקט', points: 1 },
  LINKS_PLACEHOLDER: { text: 'יש קישורים שאינם מובילים לשום מקום (href="#" או ריק) – יש לקשר לדף מידע אמיתי', points: 0 },
  BOX_ORDER: { text: 'סדר הרכיבים בקופסה שונה מהנדרש (כותרת, פסקה, לינקים שימושיים, רשימה, טבלה)', points: 0 },
  PATH_BACKSLASH: { text: 'בנתיב לקובץ נכתב \\ במקום / – יש להשתמש תמיד ב-/ בנתיבים באתר', points: 0 },
} satisfies Record<string, CommentDef>;

export const C = defineComments(DEFS);
