import { defineComments, type CommentDef } from '../../../grader/comments';

/**
 * Exercise 2 comments table ("טבלת הערות"), version 1.
 * Comments are numbered in the order below. Deductions follow last year's ex2 table where it had
 * the same comment (Bootstrap not used 8 / partly 4, small screens 4, table not replaced 5,
 * versions not hidden 5 / 2 / 1), otherwise exercise 1's table.
 * Once grades are published with this version, freeze it and make v2.
 */
export const DEFS = {
  // הגשה וקבצים
  MAIN_FILE_NAME: {
    text: 'קובץ הדף הראשי אינו נקרא index.html כנדרש – לכן הלינק לתיקייה בשרת אינו מציג את הדף',
    points: 2,
  },
  NO_EXTERNAL_CSS: { text: 'העיצובים שלכם לא נכתבו בקובץ CSS חיצוני (style.css) המקושר לדף', points: 2 },
  CSS_LINK_BROKEN: { text: 'הקישור לקובץ ה-CSS שלכם שגוי והעיצוב לא נטען (העיצוב נבדק לאחר תיקון הקישור)', points: 2 },
  CSS_FILE_NAME: { text: 'שם קובץ העיצוב אינו style.css כנדרש', points: 0 },
  NO_IMAGES_FOLDER: { text: 'התמונות אינן נמצאות בתיקייה בשם images כנדרש', points: 0 },
  PATH_CASE: {
    text: 'נתיב לקובץ נכתב באותיות גדולות/קטנות שונות משם הקובץ – עובד בשרת הקורס (Windows), אך ייכשל בשרתים שמבחינים ביניהן (Linux)',
    points: 0,
  },
  PATH_BACKSLASH: { text: 'בנתיב לקובץ נכתב \\ במקום / – יש להשתמש תמיד ב-/ בנתיבים באתר', points: 0 },
  INLINE_FEW: { text: 'יש מעט עיצובים שנכתבו כ-style inline (נדרש שלא להשתמש ב-inline)', points: 1 },
  INLINE_MANY: { text: 'הוגדרו עיצובים רבים כ-style inline – נדרש במפורש שלא לעבוד כך', points: 3 },

  // הגדרת Bootstrap
  NO_BOOTSTRAP: {
    text: 'לא נעשה שימוש ב-Bootstrap: הפריסה לא נבנתה במחלקות הספרייה (row / col-*) כנדרש בתרגיל',
    points: 8,
  },
  BOOTSTRAP_NOT_LOADED: {
    text: 'הקישור ל-Bootstrap חסר או שגוי והספרייה לא נטענת בדף (הדף נבדק לאחר הוספת הקישור)',
    points: 3,
  },
  BOOTSTRAP_NOT_RTL: {
    text: 'קושר הקובץ bootstrap.min.css במקום bootstrap.rtl.min.css – בדף מימין לשמאל הריווחים (למשל של הרשימות) הפוכים',
    points: 1,
  },
  BOOTSTRAP_AFTER_STYLE: {
    text: 'הקישור לקובץ style.css נמצא לפני הקישור ל-Bootstrap – כך Bootstrap דורס את העיצובים שלכם. יש לקשר את style.css אחריו',
    points: 1,
  },
  BOOTSTRAP_OLD_VERSION: { text: 'קושרה גרסה ישנה של Bootstrap – בתרגיל נדרשת גרסה 5.3.3 (חלק מהמחלקות אינן קיימות בגרסה ישנה)', points: 0 },
  NO_VIEWPORT: {
    text: 'חסרה התגית <meta name="viewport" content="width=device-width, initial-scale=1"> – בלעדיה הדף לא מתאים את עצמו לטלפון',
    points: 1,
  },
  NO_RTL: { text: 'לא הוגדר לדף כיוון מימין לשמאל (dir="rtl" בתגית html)', points: 1 },
  NO_LANG: { text: 'לא הוגדרה שפת הדף (lang="he" בתגית html)', points: 0 },
  OWN_CSS_LAYOUT: {
    text: 'חלק מהפריסה הרספונסיבית נעשה ב-CSS שלכם במקום במחלקות Bootstrap הנדרשות בתרגיל',
    points: 4,
  },
  BOOTSTRAP_CLASSES: { text: 'חלק ממחלקות Bootstrap שבטבלת התרגיל לא נמצאות בדף (התוצאה תקינה, לא ירדו נקודות)', points: 0 },
  CLASS_SYNTAX: {
    text: 'מחלקות נכתבו עם נקודה או מופרדות בפסיק – בתכונה class כותבים את שמות המחלקות בלי נקודה ומפרידים ביניהן ברווח',
    points: 0,
  },
  UNKNOWN_CLASSES: { text: 'נעשה שימוש בשמות מחלקות שאינם קיימים ב-Bootstrap 5 (למשל col-xs-12) – אין להן השפעה', points: 0 },

  // מבנה הדף
  CLASS_NAMES: { text: 'השתמשתם בשמות מחלקות שונים מהנדרש בתרגיל. נא להיצמד לדרישות (לא ירדו נקודות)', points: 0 },
  LAST_YEAR: { text: 'הגשתם פתרון של מטלה משנה שעברה ולא ביצעתם את השינויים של השנה הנוכחית', points: 2 },
  DUPLICATE_ID: { text: 'קוד HTML לא תקין: אותו id הוגדר מספר פעמים בדף', points: 1 },
  SKELETON: { text: 'חסרים רכיבים בשלד הדף (DOCTYPE / meta charset / title)', points: 0 },
  REQUIRED_TEXTS: {
    text: 'הכותרות בדף שונות מהנדרש (שפות לפיתוח אתרים / לינקים שימושיים / גרסאות מתקדמות ולינק למידע / עוד שפות פופולריות)',
    points: 1,
  },
  PAGE_NOT_FLUID: {
    text: 'המעטפת המרכזית אינה מתפרסת על כל רוחב המסך – נדרשת לה המחלקה container-fluid (למשל במקום container)',
    points: 1,
  },
  HORIZONTAL_SCROLL: { text: 'הדף רחב מהמסך ונוצרת גלילה אופקית (למשל row שאינו בתוך container, או רוחב קבוע)', points: 1 },

  // אזור הכותרת
  NO_HEADER: { text: 'חסר אזור הכותרת (div עם המחלקות col-12 page-header)', points: 5 },
  NO_H1: { text: 'באזור הכותרת חסרה כותרת ראשית בתגית h1', points: 1 },
  NO_HEADER_IMG: { text: 'באזור הכותרת חסרה תמונת הכותרת', points: 1 },
  HEADER_IMG_OVERFLOW: {
    text: 'תמונת הכותרת רחבה מהמסך בטלפון – חסרה לה המחלקה img-fluid',
    points: 1,
  },
  HEADER_NOT_GRAY: { text: 'לאזור הכותרת לא הוגדר רקע אפור', points: 1 },
  HEADER_NOT_WHITE: { text: 'לאזור הכותרת לא הוגדר טקסט לבן', points: 1 },

  // כרטיסי השפות
  NO_CARDS: { text: 'חסר אזור המידע על השפות (שורה עם המחלקות row gy-4 languages ובה שלושה כרטיסים)', points: 10 },
  FEW_CARDS: { text: 'חסרים כרטיסי מידע – נדרשים שלושה כרטיסים (HTML, CSS, JavaScript)', points: 3, perUnit: true },
  CARD_CONTENT: { text: 'בכרטיס חסר חלק מהתוכן של תרגיל 1 (כותרת h2, פסקה, כותרת h5, רשימת קישורים)', points: 1 },
  NO_CARD: { text: 'קופסאות המידע לא הוחלפו בכרטיסים של Bootstrap (div עם המחלקות card h-100 box)', points: 2 },
  CARD_UNEQUAL_HEIGHT: {
    text: 'הכרטיסים באותה שורה אינם באותו גובה – חסרה המחלקה h-100 לכרטיס',
    points: 1,
  },
  CARDS_NO_GAP: { text: 'כשהכרטיסים יורדים שורה אין ביניהם רווח אנכי – חסרה המחלקה gy-4 לשורה', points: 1 },
  BOX_OLD_LAYOUT: {
    text: 'לא הוסרו הגדרות ה-float, הרוחב והמרווחים של box מתרגיל 1 – הכרטיס אינו ממלא את העמודה שלו',
    points: 2,
  },
  OLD_FLOAT_CSS: { text: 'נשארו בקובץ ה-CSS הגדרות float / clear מתרגיל 1 שאינן נחוצות עוד (לא ירדו נקודות)', points: 0 },
  CARD_NO_SHADOW: { text: 'הכרטיסים איבדו את הצל מתרגיל 1 (יש לשמור על שאר העיצובים)', points: 1 },
  TITLES_SAME_COLOR: { text: 'כותרות השפות לא נצבעו בצבעים שונים', points: 1 },
  BOX_OVERFLOW: { text: 'תוכן חורג מגבולות הכרטיס (טקסט / אזור הגרסאות יוצאים מהכרטיס)', points: 1 },
  LINKS_PLACEHOLDER: { text: 'יש קישורים שאינם מובילים לשום מקום (href="#" או ריק) – יש לקשר לדף מידע אמיתי', points: 0 },

  // פריסה רספונסיבית של הכרטיסים
  CARDS_XS: { text: 'במסך קטן (פחות מ-576px) כל כרטיס צריך לתפוס שורה שלמה (col-12)', points: 2 },
  CARDS_SM: { text: 'במסכים ברוחב 576–991px צריכים להופיע שני כרטיסים בשורה (col-sm-6)', points: 4 },
  CARDS_SM_FROM_MD: {
    text: 'שני כרטיסים בשורה מופיעים רק החל מ-md (768px) ולא החל מ-sm (576px) כנדרש – יש להשתמש ב-col-sm-6',
    points: 2,
  },
  CARDS_SM_LAST: {
    text: 'במסכים ברוחב 576–991px הכרטיס האחרון תופס שורה שלמה במקום חצי שורה (col-sm-6 לכל הכרטיסים)',
    points: 2,
  },
  CARDS_MD: {
    text: 'בגודל md (768–991px) צריכים להופיע שני כרטיסים בשורה – ממשיכה לפעול ההגדרה של sm',
    points: 2,
  },
  CARDS_LG: { text: 'החל מ-992px צריכים להופיע שלושה כרטיסים בשורה (col-lg-4)', points: 4 },
  CARDS_LG_FROM_XL: {
    text: 'שלושה כרטיסים בשורה מופיעים רק החל מ-1200px (xl) ולא החל מ-992px (lg) כנדרש – יש להשתמש ב-col-lg-4',
    points: 2,
  },

  // אזור הגרסאות
  VERSIONS_MISSING: { text: 'בכרטיסים חסר אזור הגרסאות המתקדמות (שהחליף את הטבלה של תרגיל 1)', points: 8 },
  VERSIONS_TABLE_KEPT: {
    text: 'הטבלה לא הוחלפה ב-div עם שלוש שורות (row g-0) ובכל אחת שני תאים (col-6 border p-2) כנדרש',
    points: 5,
  },
  VERSIONS_SHAPE: {
    text: 'מבנה אזור הגרסאות שגוי: נדרשות שלוש שורות ובכל אחת שני תאים זה לצד זה (row g-0 ו-col-6)',
    points: 2,
  },
  VERSIONS_CELLS: { text: 'לתאים באזור הגרסאות חסרים מסגרת או ריפוד (המחלקות border p-2)', points: 1 },
  VERSIONS_GUTTER: {
    text: 'התאים באזור הגרסאות חורגים מהאזור או שיש רווחים ביניהם – חסרה המחלקה g-0 לשורות',
    points: 1,
  },
  VERSIONS_NO_LINKS: { text: 'בעמודת "לינק למידע" באזור הגרסאות חסרים קישורים', points: 1 },
  VERSIONS_NOT_HIDDEN: {
    text: 'אזור הגרסאות אינו מוסתר במסכים קטנים – נדרש להציג אותו רק החל מ-md (המחלקות d-none d-md-block)',
    points: 5,
  },
  VERSIONS_HIDE_BROKEN: {
    text: 'נכתבו מחלקות להסתרת אזור הגרסאות, אך הוא עדיין מוצג במסכים קטנים (d-none d-md-block על ה-div העוטף)',
    points: 2,
  },
  VERSIONS_HIDE_ONE_SIZE: {
    text: 'אזור הגרסאות מוסתר רק באחד משני הגדלים הקטנים (xs / sm) – נדרש להסתיר אותו בשניהם',
    points: 1,
  },
  VERSIONS_HIDDEN_AT_MD: {
    text: 'אזור הגרסאות מוסתר גם בגודל md (768–991px) – נדרש להציג אותו החל מ-md (d-md-block)',
    points: 1,
  },
  VERSIONS_ALWAYS_HIDDEN: {
    text: 'אזור הגרסאות מוסתר בכל גדלי המסך – נדרש להציג אותו החל מ-md (d-md-block)',
    points: 2,
  },

  // אזור שפות פופולריות
  NO_POPULAR: { text: 'חסר אזור השפות הפופולריות (div עם המחלקות col-12 popular-languages)', points: 5 },
  POPULAR_NO_TITLE: { text: 'באזור השפות הפופולריות חסרה כותרת', points: 1 },
  POPULAR_FEW_IMGS: { text: 'באזור השפות הפופולריות יש פחות משש תמונות', points: 1, perUnit: true, max: 3 },
  POPULAR_NOT_ONE_ROW: {
    text: 'שש התמונות צריכות להתחלק שווה בשורה אחת בכל גדלי המסך (שש עמודות col-2)',
    points: 2,
  },
  POPULAR_NO_GRID: {
    text: 'התמונות לא סודרו בשורה (row) עם שש עמודות col-2 – הן עומדות זו לצד זו רק כי תמונות הן אלמנטים inline',
    points: 1,
  },
  POPULAR_IMG_OVERFLOW: { text: 'בטלפון התמונות רחבות מהעמודות שלהן – חסרה להן המחלקה img-fluid', points: 1 },
  POPULAR_NOT_GRAY: { text: 'לאזור השפות הפופולריות לא הוגדר רקע אפור', points: 1 },
  POPULAR_NOT_WHITE: { text: 'לאזור השפות הפופולריות לא הוגדר טקסט לבן', points: 1 },

  // תמונות
  IMG_BROKEN_ONE: { text: 'אחת התמונות לא מוצגת (נתיב שגוי או קובץ חסר)', points: 1 },
  IMG_BROKEN_MANY: { text: 'מספר תמונות לא מוצגות (נתיבים שגויים או קבצים חסרים)', points: 2 },
  IMG_STRETCHED: { text: 'התמונות מעוותות – יש להגדיר רק רוחב או רק גובה כדי לשמור על היחס', points: 1 },
} satisfies Record<string, CommentDef>;

export const C = defineComments(DEFS);
