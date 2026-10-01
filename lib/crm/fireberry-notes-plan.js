/**
 * lib/crm/fireberry-notes-plan.js — אילו לידים בודקים בסנכרון ההערות הבא, ובאיזה סדר (T9).
 *
 * כל בדיקה של ליד = קריאה לרשימת ההערות שלו (ועוד קריאה לכל הערה חדשה). בקצב של 40 לדקה
 * ו-40 שניות לריצה, ריצה שעתית מספיקה ~15–25 לידים — ~300 ביום. עד 1.10 הכלל היה
 * "ליד מ-7 הימים האחרונים, כל 6 שעות", ולידים ישנים יותר לא נבדקו שוב אף פעם:
 *   • התור עמד על ~260 לידים (job_log, 1.10) — כלומר ה-6 שעות לא התקיימו בפועל,
 *     והמיון לפי "החדש ביותר קודם" השאיר את הלידים בני 5–7 ימים בסוף התור תמיד;
 *   • הערה שנכתבת על ליד בן שבועיים (פגישה, התנגדות, "לא רלוונטי") לא נכנסה לעולם.
 *
 * עכשיו כל ליד נבדק שוב בתדירות לפי גילו (RECHECK_TIERS), והסדר הוא "הכי מאחר יחסית
 * לתדירות שלו", כפול משקל — כך שכשאין מספיק קריאות, התור מתחלק בין כל הגילים במקום
 * שהחדשים ירעיבו את כל השאר, אבל ליד מהיום עדיין קודם לליד בן חודשיים שאיחר באותה
 * מידה (המשקל: אצל ליד טרי ההערה הראשונה, שממנה זמן התגובה, עוד לא נכתבה).
 * ליד שמעולם לא נבדק — תמיד קודם.
 *
 * החשבון לאלפא (~17 לידים ביום): <1 יום כל 4 ש' ≈ 100 בדיקות ביום, 1–7 ימים פעם ביום
 * ≈ 100, 7–30 ימים פעם בשבוע ≈ 55, ישנים פעם בחודש ≈ 30. סה"כ ~285 — בתוך ~300.
 */

export const RECHECK_TIERS = [
  { key: 'day',   maxAgeDays: 1,        everyHours: 4,       weight: 4 },
  { key: 'week',  maxAgeDays: 7,        everyHours: 24,      weight: 2 },
  { key: 'month', maxAgeDays: 30,       everyHours: 24 * 7,  weight: 1 },
  { key: 'old',   maxAgeDays: Infinity, everyHours: 24 * 30, weight: 1 },
]

const ts = (s) => { const t = new Date(String(s || '').replace(' ', 'T')).getTime(); return Number.isFinite(t) ? t : NaN }

export function tierFor(createdon, now = Date.now()) {
  const c = ts(createdon)
  // ליד בלי תאריך יצירה תקין — כמו ישן: נבדק לעיתים רחוקות, לא נעלם.
  const ageDays = Number.isFinite(c) ? (now - c) / 86400000 : Infinity
  return RECHECK_TIERS.find(t => ageDays < t.maxAgeDays) || RECHECK_TIERS[RECHECK_TIERS.length - 1]
}

/**
 * @param leads  לידים (accountid, createdon)
 * @param index  Map<accountid, {checkedAt}> מ-note_index
 * @returns {{todo: object[], stats: {neverChecked:number, due:Object<string,number>}}}
 *   todo — לידים לבדיקה לפי הסדר. ריצה עוברת עליהם עד שנגמר התקציב.
 */
export function planNoteChecks(leads, index, now = Date.now()) {
  const never = [], due = []
  const stats = { neverChecked: 0, due: Object.fromEntries(RECHECK_TIERS.map(t => [t.key, 0])) }
  for (const l of leads || []) {
    const id = String(l?.accountid || '')
    if (!id) continue
    const ix = index.get(id)
    if (!ix) { never.push(l); stats.neverChecked++; continue }
    const tier = tierFor(l.createdon, now)
    const last = ts(ix.checkedAt)
    // checkedAt פגום = כאילו לא נבדק מזמן, בתוך השכבה שלו.
    const overdue = Number.isFinite(last) ? (now - last) / (tier.everyHours * 3600000) : Infinity
    if (overdue >= 1) { due.push({ l, score: overdue * tier.weight }); stats.due[tier.key]++ }
  }
  const newer = (a, b) => String(b.createdon || '').localeCompare(String(a.createdon || ''))
  never.sort(newer)
  due.sort((a, b) => (b.score - a.score) || newer(a.l, b.l))
  return { todo: [...never, ...due.map(x => x.l)], stats }
}
