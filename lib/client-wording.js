/**
 * ניסוח כל טקסט שהלקוח רואה בנושא טיפול בלידים (דשבורד, PDF, ניתוח AI) — ש.ברוך, 1.11.
 *
 * המדד הישן "לא קיבלו מענה" ספר כל ליד שאחריו לא נרשמה פעולה ב-CRM, גם כשנציגה סיווגה אותו וסגרה
 * בלי לרשום שיחה — ונקרא כהאשמה של צוות המכירות. מעכשיו: שלוש קבוצות (lib/crm/bmby-summary.js,
 * leadGroups), ניסוח תיאורי בלבד, ושורת "איך נמדד" מתחת לכל מספר.
 */

// ביטויים שאסור שיופיעו בטקסט ללקוח. בדיקה אוטומטית: scripts/tests/report-pdf.smoke.mjs ו-ai-analysis.
export const FORBIDDEN_CLIENT_PHRASES = [
  { re: /לא\s+קיבל(?:ו|ה)?\s+מענה/, label: 'לא קיבלו מענה' },
  { re: /בלי\s+מענה/, label: 'בלי מענה' },
  { re: /לא\s+טופל(?:ו|ה)?(?![\u0590-\u05FF])/, label: 'לא טופלו' },
  { re: /הוזנח/, label: 'הוזנחו' },
  { re: /(?:פספס|פוספס|פיספס)/, label: 'פספסו' },
  { re: /לא\s+חזר(?:ו|ה)?\s+אלי/, label: 'לא חזרו אליהם' },
]

/** מחזיר את הביטויים האסורים שמופיעים בטקסט (ריק = תקין). */
export function findForbidden(text) {
  const s = String(text || '')
  return FORBIDDEN_CLIENT_PHRASES.filter(p => p.re.test(s)).map(p => p.label)
}

export const HANDLING_LABELS = {
  documented: 'טופלו ומתועדים',
  classifiedNoCall: 'סווגו ללא תיעוד שיחה',
  waiting: 'ממתינים לטיפול',
  repeat: 'לידים חוזרים',
  inWindow: 'בחלון מענה',
}

export const HANDLING_METHOD = 'מבוסס על פעולות מתועדות ב-CRM (משימה, הערה, SMS, וואטסאפ, פגישה, או סיכום שיחה בליד). שיחה שלא תועדה לא נספרת. כל לקוח נספר פעם אחת.'
export const RESPONSE_TIME_METHOD = 'נמדד מכניסת הליד ועד הפעולה המתועדת הראשונה ב-CRM. שיחה שלא תועדה לא נכנסת לחישוב.'
