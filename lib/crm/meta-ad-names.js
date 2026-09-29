/**
 * lib/crm/meta-ad-names.js — שם מודעה לפי מזהה, מתוך ad_daily.
 *
 * למה (ויטלי, 29.9, ש.ברוך): מ-14.8.2026 האינטגרציה Meta → BMBY מעבירה ללידים את
 * "מזהה מודעה" / "מזהה סדרת מודעות" / "מזהה קמפיין" אבל כבר לא את "שם מודעה". נמדד ב-crm_raw:
 * בספטמבר 23 מתוך 188 לידים של HI PARK עם שם, 122 עם מזהה בלבד (ONCE 11/162, REHAVIA 0/66 —
 * ברחביה שם המודעה לא הגיע אף פעם). השינוי זהה בשלושת הפרויקטים ובאותו יום, כלומר שינוי מיפוי
 * בטופס/באינטגרציה ולא תקלה נקודתית.
 *
 * המזהה מספיק: 601 מתוך 605 לידים עם מזהה נמצאים ב-ad_daily (החשבון המשותף 1933376664223119).
 * החיבור לפי מזהה ולא לפי שם גם עמיד לשינוי שם של מודעה בחשבון המשותף.
 */

/** מזהי מודעה של לקוחות BMBY שאין להם "שם מודעה" (רק אותם צריך להשלים). */
export function bmbyAdIdsMissingName(clients) {
  const ids = new Set()
  for (const c of clients || []) {
    const cf = c && c._cf
    if (!cf) continue
    const name = String(cf['שם מודעה'] || '').trim()
    const id = String(cf['מזהה מודעה'] || '').replace(/\D/g, '')
    if (!name && id) ids.add(id)
  }
  return [...ids]
}

/**
 * ad_id → { ad, adset, campaign } מ-ad_daily (פייסבוק), לפי היום האחרון שבו המודעה הופיעה.
 *
 * ⚠️ 29.9: הגרסה הראשונה הריצה שאילתה נפרדת לכל מזהה על ad_daily — בלי אינדקס על ad_id,
 *    כלומר סריקה של ~415 אלף שורות לכל אחד מ-600 המזהים, 10–52 שניות כל אחת, בכל פתיחה
 *    של טווח אצל ש.ברוך. זה הציף את בסיס הנתונים ב-12:17 UTC והפיל כניסות למשך 4 דקות.
 *    עכשיו: קריאה אחת לפונקציה meta_ad_names (מיגרציה 022, אינדקס על ad_id), במנות של
 *    CHUNK. אם הפונקציה עוד לא קיימת — מחזירים מפה ריקה. **אין נפילה חזרה לסריקה.**
 */
const CHUNK = 500
export async function loadMetaAdNames(sb, adIds) {
  const out = new Map()
  const ids = [...new Set((adIds || []).map(String).filter(Boolean))]
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await sb.rpc('meta_ad_names', { ids: ids.slice(i, i + CHUNK) })
    if (error) return out   // מיגרציה 022 עוד לא רצה, או תקלה — בלי שמות, בלי עומס
    for (const r of data || []) if (r?.ad_id && r.ad) out.set(String(r.ad_id), { ad: r.ad, adset: r.adset || '', campaign: r.campaign || '' })
  }
  return out
}

/** אותו דבר, בלי לזרוק לעולם — לנתיבים שבהם ההשלמה היא תוספת ולא תנאי. */
export async function adNamesForBmby(sb, clients) {
  try {
    const ids = bmbyAdIdsMissingName(clients)
    return ids.length ? await loadMetaAdNames(sb, ids) : new Map()
  } catch {
    return new Map()
  }
}
