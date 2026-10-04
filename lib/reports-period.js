/**
 * lib/reports-period.js — מפתח תקופה אחד לכל מקור.
 *
 * לחודש מלא שמורים לרוב שני דוחות זהים: "2026-09" (קרון החודשים) ו-"2026-09-01_2026-09-30"
 * (קרון הטווחים). מי שקורא את שני המפתחות ומחבר שורות — סופר פעמיים. ב-4.10 זה הכפיל את
 * הוצאת ספטמבר של HI PARK ב-API (₪41,405 במקום ₪20,703).
 *
 * @param rows       שורות reports ({source, month, ...})
 * @param preferred  מפתחות לפי סדר העדפה
 * @returns אותן שורות, אבל לכל source רק אלה של המפתח המועדף הראשון שיש לו.
 */
export function onePeriodPerSource(rows, preferred) {
  const rank = (m) => { const i = preferred.indexOf(m); return i < 0 ? Infinity : i }
  const best = new Map()
  for (const r of rows || []) {
    const k = r?.source || ''
    if (!best.has(k) || rank(r.month) < rank(best.get(k))) best.set(k, r.month)
  }
  return (rows || []).filter(r => r && best.get(r.source || '') === r.month)
}
