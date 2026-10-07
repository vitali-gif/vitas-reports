/**
 * lib/focus.js — מצבי מיקוד: תצוגה של חלק מפרויקט (סניף + סוכנות הפרסום שלו). D14.
 *
 * KLOSS "רק באר שבע" (ויטלי, 23.9 + 7.10):
 *   - CRM (Salesforce): לידים והזדמנויות עם Branch_Name__c = 'באר שבע' (צורת כתיבה אחת בלבד).
 *   - מודעות: רק החשבונות של VITAS — התיוג 'VITAS' של klossAgencyOf / klossGoogleAgencyOf.
 *     סיגאווי לא מפרסמת לבאר שבע (7.10), ולכן כל הלידים הממומנים של הסניף שייכים לתקציב הזה.
 *   - אדמין וגם לקוח; לא נשמר — כל כניסה מתחילה ב"הכל".
 *
 * המפתח (id) הוא מה שעובר ב-URL (?focus=beersheva) — רשימה סגורה, לא טקסט חופשי.
 */
export const FOCUS_MODES = {
  beersheva: { id: 'beersheva', label: 'רק באר שבע', projects: ['kloss'], branch: 'באר שבע', agency: 'VITAS' },
}

const projKey = (name) => String(name || '').toLowerCase().trim()

/** מצבי המיקוד שזמינים לפרויקט (לפי שם), לתצוגת הכפתורים. */
export function focusModesFor(projectName) {
  const k = projKey(projectName)
  return Object.values(FOCUS_MODES).filter(m => m.projects.includes(k))
}

/** מצב מיקוד לפי id, רק אם הוא חל על הפרויקט. אחרת null. */
export function focusFor(projectName, id) {
  const m = id ? FOCUS_MODES[id] : null
  return m && m.projects.includes(projKey(projectName)) ? m : null
}

/**
 * מקור ליד ממומן (KLOSS / Salesforce LeadSource) — לעלות לליד במצב מיקוד: תקציב הסוכנות חלקי הלידים
 * שהגיעו מהמודעות בלבד, אחרת לידים אורגניים (אתר החברה, מוקד טלפוני, המלצת חבר) מורידים אותה בלי קשר
 * לקמפיינים (TASKS D14). הערכים כפי שהם ב-Salesforce (7.10): "פייסבוק טופס לידים", "גוגל חיפוש",
 * "עמוד נחיתה…" (כולל עמודי מבצע), "ig", "fb".
 */
export function isPaidLeadSource(src) {
  const s = String(src || '').trim()
  return /^(פייסבוק|גוגל|עמוד נחיתה|facebook|google|instagram)/i.test(s) || /^(ig|fb)$/i.test(s)
}
