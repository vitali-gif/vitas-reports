/**
 * lib/crm/salesforce-common.js — קבועים ועזרים של Salesforce, משותפים ל-salesforce-summary.js
 * (חיקוי השאילתות) ול-salesforce-shape.js (העיצוב, נוצר מה-route). הועתקו מ-app/api/salesforce/fetch/route.js כמו שהם.
 */
export const CHAIN = 'קלוס'
export const STAGE_PAID = 'הזמנה - שולמה מקדמה'
export const STAGE_QUOTE = 'קיבל הצעת מחיר'
export const STAGE_LOST = 'נסגר ללא הצלחה'
export const STATUS_NOSHOW = 'לא הגיעו לפגישה'
export const STATUS_SCHEDULED = 'Nurturing'
export const STATUS_ARRIVED = ['Qualified']
export const STATUS_MEET = ['Nurturing', 'Qualified', 'לא הגיעו לפגישה']
export const DOW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

export function israelOffsetHours(dateStr) {
  try {
    const d = new Date(dateStr + 'T12:00:00Z')
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', timeZoneName: 'shortOffset' }).formatToParts(d)
    const tz = (parts.find(p => p.type === 'timeZoneName') || {}).value || 'GMT+3'
    const m = /GMT([+-]\d+)/.exec(tz)
    return m ? parseInt(m[1], 10) : 3
  } catch { return 3 }
}
// Business-hours between two UTC timestamps, in Israel local time.
// Sun-Thu 09:00-21:00, Fri 09:00-13:30, Sat closed.
export function businessHoursBetween(startMs, endMs, off) {
  if (!(endMs > startMs)) return 0
  const s = startMs + off * 3600000, e = endMs + off * 3600000 // shift to Israel wall-clock (read via getUTC*)
  const OPEN = 9 * 3600000
  let total = 0
  let t0 = new Date(s); t0.setUTCHours(0, 0, 0, 0)
  for (let t = t0.getTime(); t <= e; t += 86400000) {
    const dow = new Date(t).getUTCDay() // 0=Sun..6=Sat
    if (dow === 6) continue // Saturday closed
    const close = (dow === 5 ? 13.5 : 21) * 3600000 // Fri 13:30, else 21:00
    const winStart = t + OPEN, winEnd = t + close
    const ovS = Math.max(s, winStart), ovE = Math.min(e, winEnd)
    if (ovE > ovS) total += (ovE - ovS)
  }
  return total / 3600000
}
export function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n }
export function r0(v) { return Math.round(num(v)) }
export function pairs(recs, keyField, countField) {
  const m = {}
  for (const r of recs) m[(r[keyField] === null || r[keyField] === undefined || r[keyField] === '') ? 'לא ידוע' : r[keyField]] = r[countField]
  return m
}

