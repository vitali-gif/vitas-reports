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
 * שאילתה קצרה לכל מזהה (limit 1, מהיום האחרון אחורה) ולא IN אחד גדול: ל-ad_daily (~415 אלף
 * שורות) אין אינדקס על ad_id, ולכל מודעה יש שורה לכל יום × גיל × מגדר — IN היה מחזיר עשרות
 * אלפי שורות ונחתך בתקרת ה-1,000 של PostgREST. המזהים החסרים הם עשרות, לא אלפים.
 * כישלון של מזהה בודד פשוט משאיר אותו בלי שם.
 */
export async function loadMetaAdNames(sb, adIds, { concurrency = 8 } = {}) {
  const out = new Map()
  const ids = [...new Set((adIds || []).map(String).filter(Boolean))]
  let i = 0
  const worker = async () => {
    while (i < ids.length) {
      const id = ids[i++]
      try {
        const { data } = await sb.from('ad_daily')
          .select('ad, adset, campaign')
          .eq('source', 'facebook').eq('ad_id', id)
          .order('day', { ascending: false }).limit(1)
        const r = data && data[0]
        if (r && r.ad) out.set(id, { ad: r.ad, adset: r.adset || '', campaign: r.campaign || '' })
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker))
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
