import { defineComments, type CommentDef } from '../../../grader/comments';
import { DEFS as V2 } from './v2';

/**
 * Exercise 1 comments table, version 3 (see CHANGELOG.md).
 * The submission-procedure comments (101+, grader/protocol-comments.ts) are added to every
 * exercise by the registry; extra files are now one of them (105), so 52 is no longer given.
 * Once grades are published with this version, freeze it and make v4.
 */
export const DEFS = {
  ...V2,
  EXTRA_FILES: { text: 'בוטלה – הוחלפה בהערת נוהל ההגשה 105', points: 0 },
  // שרת הקורס (Windows) אינו מבחין בין אותיות גדולות לקטנות, לכן ההערה אינה טוענת שהדף נשבר בו
  PATH_CASE: {
    text: 'נתיב לקובץ נכתב באותיות גדולות/קטנות שונות משם הקובץ – עובד בשרת הקורס (Windows), אך ייכשל בשרתים שמבחינים ביניהן (Linux)',
    points: 0,
  },

  // חדש בגרסה 3 (כיול על כל ההגשות)
  BOX_SPLIT_LIST: {
    text: 'כל קישור ברשימה נכתב בתוך ul נפרד – יש לכתוב רשימה אחת (ul) ובה פריט li לכל קישור',
    points: 1,
  },
  TABLE_COLUMNS_SWAPPED: {
    text: 'כותרות הטבלה אינן תואמות לעמודות: הקישורים אינם בעמודה "לינק למידע"',
    points: 1,
  },
  BOX_OVERFLOW: { text: 'תוכן חורג מגבולות קופסת המידע (טקסט/טבלה יוצאים מהקופסה)', points: 1 },
  NARROW_LAYOUT: {
    text: 'במסך צר יותר (מחשב נייד, 1366px) הפריסה נשברת – תוכן חורג מהקופסאות או שהקופסאות יורדות שורה (לא ירדו נקודות)',
    points: 0,
  },
} satisfies Record<string, CommentDef>;

export const C = defineComments(DEFS);
