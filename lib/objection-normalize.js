// Objection name normalization for BMBY data.
// Translates English BMBY internal labels to Hebrew, handles comma-separated multi-objections.

const VARIANT_TO_CANONICAL = {
  // English → Hebrew
  'unserious': 'לא רציני',
  'bad contact': 'קשר לא תקין',
  'price': 'מחיר',
  'state/region': 'אזור/מיקום',
  'state / region': 'אזור/מיקום',
  'model': 'דגם',
  'invalid phone number': 'מספר טלפון לא תקין',
  'object not in stock': 'לא במלאי',
  'handover date': 'תאריך מסירה',
  'financing problem': 'בעיית מימון',
  'planning of building': 'תכנון בניין',
  'refund ability': 'יכולת החזר',
  'internal design': 'עיצוב פנים',
  'too many neighbors': 'יותר מדי שכנים',
  'other': 'אחר',
  // Hebrew variants → canonical
  'מתווך/ יזם/ לא לטובת רכישה': 'מתווך / לא לרכישה',
  'מתווך/יזם/לא לטובת רכישה': 'מתווך / לא לרכישה',
  'רוצים לקנות עם זכאות משתכן': 'מחיר למשתכן',
  'ירדו מחיפושי נכס': 'ירד מחיפוש נכס',
  'לא השאיר  פרטים': 'לא השאיר פרטים', // double space
  'תלוי במכירת נכס': 'תלוי במכירת נכס',
  'צמוד קרקע/קוטג': 'צמוד קרקע / קוטג׳',
  'צמוד קרקע/קוטג׳': 'צמוד קרקע / קוטג׳',
  'ליד כפול': 'ליד כפול',
  'בוחן עוד אפשרויות': 'בוחן עוד אפשרויות',
  'לנסות שוב עוד שנה': 'דחייה - שנה הבאה',
  'מועד מסירה': 'תאריך מסירה',
}

function normalizeOne(s) {
  if (!s) return ''
  const clean = String(s).trim().replace(/\s+/g, ' ')
  if (!clean) return ''
  const lower = clean.toLowerCase()
  if (VARIANT_TO_CANONICAL[clean]) return VARIANT_TO_CANONICAL[clean]
  if (VARIANT_TO_CANONICAL[lower]) return VARIANT_TO_CANONICAL[lower]
  return clean
}

/**
 * Normalize an objection string from BMBY.
 * Splits comma-separated values, normalizes each, returns array of canonical labels.
 */
export function normalizeObjections(input) {
  if (!input) return []
  return String(input)
    .split(/[,;|]/)
    .map(normalizeOne)
    .filter(Boolean)
}

// ── סיווגים שדורשים בדיקה (ש.ברוך, 1.11) ──
// התנגדות שמבוססת על מוצא הפונה ולא על הצורך או התקציב שלו. באדמין מסומנת "סיווג שדורש בדיקה";
// בכל מה שהלקוח רואה (דשבורד בתצוגת לקוח, PDF, ניתוח AI) היא לא מופיעה בשמה — רק בתוך
// המצטבר "סווגו ללא תיעוד שיחה".
const REVIEW_OBJECTIONS = [/מגזר\s*ערבי/, /אי\s*התאמה\s*מגזרית/, /לא\s*רלוונטי\s*שפה/]  // השלישי: סטטוס בפיירברי (אלפא)
export const REVIEW_LABEL = 'סיווג שדורש בדיקה'
// ויטלי, 1.11 (אפשרות 2): ללקוח — רק המספר, בניסוח הזה, בלי המילה "מגזר" ובלי קשר לשיחות.
export const OFF_TARGET_LABEL = 'לא תואמים לקהל היעד של הפרויקט'
export function isReviewObjection(label) {
  const s = String(label || '')
  return REVIEW_OBJECTIONS.some(re => re.test(s))
}
