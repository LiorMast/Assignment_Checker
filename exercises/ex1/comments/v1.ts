import { defineComments } from '../../grader/comments';

/**
 * Exercise 1 comments table ("טבלת הערות").
 * Comments are numbered in the order below; once grading has started, only append new ones.
 * Deductions follow last year's table: mostly 1–2 points, 5–10 for a missing section, 0 for notes.
 */
export const C = defineComments({
  // הגשה וקבצים
  MAIN_FILE_NAME: { text: 'קובץ הדף הראשי אינו נקרא index.html כנדרש', points: 0 },
  NO_EXTERNAL_CSS: { text: 'העיצוב לא נכתב בקובץ CSS חיצוני המקושר לדף (או שהקובץ ריק)', points: 2 },
  CSS_LINK_BROKEN: { text: 'הקישור לקובץ ה-CSS שגוי והעיצוב לא נטען (העיצוב נבדק לאחר תיקון הקישור)', points: 2 },
  CSS_FILE_NAME: { text: 'שם קובץ העיצוב אינו style.css כנדרש', points: 0 },
  NO_IMAGES_FOLDER: { text: 'התמונות אינן נמצאות בתיקייה בשם images כנדרש', points: 0 },
  PATH_CASE: { text: 'נתיב לקובץ נכתב באותיות גדולות/קטנות שונות משם הקובץ – יעבוד ב-Windows אך לא בשרת', points: 0 },
  INLINE_FEW: { text: 'יש מעט עיצובים שנכתבו כ-style inline (נדרש שלא להשתמש ב-inline)', points: 1 },
  INLINE_MANY: { text: 'הוגדרו עיצובים רבים כ-style inline – נדרש במפורש שלא לעבוד כך', points: 3 },

  // מבנה הדף
  NO_PAGE_DIV: { text: 'חסר div מרכזי עם המחלקה page', points: 1 },
  NO_RTL: { text: 'לא הוגדר לדף כיוון מימין לשמאל (rtl)', points: 1 },
  CLASS_NAMES: { text: 'השתמשתם בשמות מחלקות שונים מהנדרש בתרגיל. נא להיצמד לדרישות (לא ירדו נקודות)', points: 0 },
  LAST_YEAR: { text: 'הגשתם פתרון של מטלה משנה שעברה ולא ביצעתם את השינויים של השנה הנוכחית', points: 2 },
  DUPLICATE_ID: { text: 'קוד HTML לא תקין: אותו id הוגדר מספר פעמים בדף', points: 1 },
  SKELETON: { text: 'חסרים רכיבים בשלד הדף (DOCTYPE / meta charset / title)', points: 0 },

  // אזור הכותרת
  NO_HEADER: { text: 'חסר אזור הכותרת (div עם המחלקה page-header)', points: 5 },
  NO_H1: { text: 'באזור הכותרת חסרה כותרת ראשית בתגית h1', points: 1 },
  NO_HEADER_IMG: { text: 'באזור הכותרת חסרה תמונה המייצגת את שלוש השפות', points: 1 },

  // אזור המידע על השפות
  NO_BOXES: { text: 'חסר אזור המידע על השפות (div עם המחלקה languages ובו קופסאות box)', points: 10 },
  FEW_BOXES: { text: 'חסרות קופסאות מידע – נדרשות שלוש קופסאות (HTML, CSS, JavaScript)', points: 3, perUnit: true },
  BOX_NO_H2: { text: 'בקופסת מידע חסרה כותרת h2 עם שם השפה', points: 1 },
  BOX_NO_P: { text: 'בקופסת מידע חסרה פסקה המתארת את השפה', points: 1 },
  BOX_NO_H5: { text: 'בקופסת מידע חסרה כותרת h5 "לינקים שימושיים"', points: 1 },
  BOX_NO_LIST: { text: 'בקופסת מידע חסרה רשימה לא ממוספרת עם קישורים', points: 3 },
  BOX_OL: { text: 'נעשה שימוש ברשימה ממוספרת (ol) במקום רשימה לא ממוספרת (ul)', points: 1 },
  BOX_FEW_LINKS: { text: 'ברשימת הקישורים יש פחות משני קישורים', points: 1 },
  BOX_NO_TABLE: { text: 'בקופסת מידע חסרה טבלה', points: 3 },
  TABLE_NO_HEADER: { text: 'חסרה בטבלה שורת כותרות', points: 2 },
  TABLE_TD_HEADER: { text: 'שורת הכותרות בטבלה הוגדרה עם td ולא עם th', points: 1 },
  TABLE_SHAPE: { text: 'מבנה הטבלה אינו כנדרש: שתי עמודות ולפחות שתי שורות מידע', points: 1 },
  TABLE_NO_LINKS: { text: 'בעמודת "לינק למידע" בטבלה חסרים קישורים', points: 1 },

  // אזור שפות פופולריות
  NO_POPULAR: { text: 'חסר אזור השפות הפופולריות (div עם המחלקה popular-languages)', points: 5 },
  POPULAR_NO_TITLE: { text: 'באזור השפות הפופולריות חסרה כותרת', points: 1 },
  POPULAR_FEW_IMGS: { text: 'באזור השפות הפופולריות יש פחות משש תמונות', points: 1, perUnit: true, max: 3 },

  // תמונות
  IMG_BROKEN_ONE: { text: 'אחת התמונות לא מוצגת (נתיב שגוי או קובץ חסר)', points: 1 },
  IMG_BROKEN_MANY: { text: 'מספר תמונות לא מוצגות (נתיבים שגויים או קבצים חסרים)', points: 2 },
  IMG_STRETCHED: { text: 'התמונות מעוותות – יש להגדיר רק רוחב או רק גובה כדי לשמור על היחס', points: 1 },

  // דרישות עיצוב
  NO_FONT: { text: 'לא הוגדר גופן לדף', points: 1 },
  NO_LIGHT_BG: { text: 'לא הוגדר לדף צבע רקע בהיר', points: 1 },
  HEADER_NOT_GRAY: { text: 'לאזור הכותרת לא הוגדר רקע אפור', points: 1 },
  HEADER_NOT_WHITE: { text: 'לאזור הכותרת לא הוגדר טקסט לבן', points: 1 },
  POPULAR_NOT_GRAY: { text: 'לאזור השפות הפופולריות לא הוגדר רקע אפור', points: 1 },
  POPULAR_NOT_WHITE: { text: 'לאזור השפות הפופולריות לא הוגדר טקסט לבן', points: 1 },
  NOT_SIDE_BY_SIDE: { text: 'שלוש קופסאות המידע אינן ממוקמות זו לצד זו', points: 5 },
  NO_FLOAT: { text: 'הקופסאות סודרו זו לצד זו ללא float (למשל flex/grid) – בתרגיל נדרש float (לא ירדו נקודות)', points: 0 },
  BOX_NO_BG: { text: 'לקופסאות המידע חסר רקע בהיר', points: 1 },
  BOX_NO_PADDING: { text: 'לקופסאות המידע חסר ריפוד (padding)', points: 1 },
  BOX_NO_RADIUS: { text: 'לקופסאות המידע חסרה מסגרת מעוגלת (border-radius)', points: 1 },
  BOX_NO_SHADOW: { text: 'לקופסאות המידע חסר צל (box-shadow)', points: 1 },
  TITLES_SAME_COLOR: { text: 'כותרות השפות לא נצבעו בצבעים שונים', points: 1 },
  NOT_CLEARED: { text: 'אזור השפות הפופולריות אינו מופיע מתחת לקופסאות הצפות (חסר clear)', points: 2 },
});
