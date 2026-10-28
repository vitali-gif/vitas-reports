/**
 * lib/ai-data-check.js — בדיקת הנתונים לפני ניתוח ה-AI (ויטלי, 28.10).
 *
 * "ניתוח AI שמנוסח בביטחון על דאטה חלקית מסוכן יותר מאין ניתוח. אם חסרים נתונים — שיאמר את זה
 * קודם, ורק אז ינתח." לכן מה שאפשר לחשב — מחושב כאן, בקוד, ולא מושאר לשיקול של המודל:
 *   • המדד שמכריע: עלות לפגישה שבוצעה (BMBY, פיירברי) או עלות למכירה (Zoho, Salesforce) — לא CPL.
 *   • n לכל המרה. פחות מ-10 = אינדיקציה בלבד, לא מסקנה.
 *   • כמה ימים בתקופה. פחות מ-30 = לא מחליטים על תקציב (חלון ההחלטה הוא 30 יום).
 *   • יום חלקי (התקופה כוללת את היום) וימים חריגים (חגים, בחירות) בתקופה ובתקופת ההשוואה.
 *   • בלי CRM — השיפוט בעיוורון.
 * התוצאה נשלחת למודל (כחלק מהקלט), נשמרת עם הניתוח, ומוצגת ראשונה במסך.
 *
 * טהור (בלי רשת ובלי SDK) — נטען גם בדפדפן.
 */

export const MIN_CONVERSIONS = 10     // מתחת לזה: אינדיקטיבי (8-10 המרות זה הסף בשיטה; לוקחים את העליון)
export const DECISION_WINDOW_DAYS = 30

// ימים חריגים בישראל. רשימה ידנית — לעדכן פעם בשנה (חגים זזים בלוח הגרגוריאני).
// ערבי חג נכללים: הפעילות יורדת כבר מהצהריים.
export const SPECIAL_DAYS = {
  '2026-04-01': 'ערב פסח', '2026-04-02': 'פסח', '2026-04-08': 'שביעי של פסח',
  '2026-04-21': 'יום הזיכרון', '2026-04-22': 'יום העצמאות',
  '2026-05-21': 'ערב שבועות', '2026-05-22': 'שבועות',
  '2026-09-11': 'ערב ראש השנה', '2026-09-12': 'ראש השנה', '2026-09-13': 'ראש השנה',
  '2026-09-20': 'ערב יום כיפור', '2026-09-21': 'יום כיפור',
  '2026-09-25': 'ערב סוכות', '2026-09-26': 'סוכות', '2026-10-02': 'הושענא רבה', '2026-10-03': 'שמחת תורה',
  '2026-10-27': 'בחירות לכנסת',
}

const ilToday = (now) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(now)
const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const dayDiff = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5)
const ddmm = (ymd) => ymd.slice(8, 10) + '.' + ymd.slice(5, 7)

/** טווח התאריכים של מפתח תקופה: '2026-10' (חודש; חודש שרץ — עד היום) או '2026-10-01_2026-10-25'. */
export function periodRange(key, now = new Date()) {
  if (!key) return null
  const today = ilToday(now)
  let since, until
  if (key.includes('_')) [since, until] = key.split('_')
  else if (/^\d{4}-\d{2}$/.test(key)) {
    const [y, m] = key.split('-').map(Number)
    since = `${key}-01`
    until = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  } else return null
  const partialToday = since <= today && until >= today
  if (until > today) until = today
  return { since, until, days: Math.max(0, dayDiff(since, until) + 1), partialToday }
}

function specialDaysIn(r) {
  if (!r) return []
  const out = []
  for (let d = r.since; d <= r.until; d = addDays(d, 1)) if (SPECIAL_DAYS[d]) out.push({ date: d, label: SPECIAL_DAYS[d] })
  return out
}

const val = (kpis, key, field = 'value') => { const k = (kpis || []).find(x => x.key === key); return k ? (Number(k[field]) || 0) : null }

/**
 * @param m  מודל הדוח (buildReportModel)
 * @returns { level: 'good'|'partial'|'insufficient', notes: string[], ...עובדות }
 */
export function dataCheck(m, { now = new Date() } = {}) {
  const kpis = m?.kpis || []
  const crmType = m?.crmType || null
  const hasCrm = !!crmType
  const hasAds = (val(kpis, 'spend') || 0) > 0
  const salesCrm = crmType === 'zoho' || crmType === 'salesforce'
  const cur = periodRange(m?.key, now), prev = periodRange(m?.prevKey, now)

  // המדד שמכריע, וה-n שלו
  const spend = val(kpis, 'spend'), prevSpend = val(kpis, 'spend', 'prev')
  const convKey = salesCrm ? 'closed' : 'meetDone'
  const n = hasCrm ? val(kpis, convKey) : null
  const prevN = hasCrm ? val(kpis, convKey, 'prev') : null
  const per = (s, c) => (s > 0 && c > 0 ? Math.round(s / c) : null)
  const decision = hasCrm ? {
    name: salesCrm ? 'עלות למכירה' : 'עלות לפגישה שבוצעה',
    value: per(spend, n), n, previous: per(prevSpend, prevN), previousN: prevN,
    indicative: (n ?? 0) < MIN_CONVERSIONS || (prevN != null && prevN < MIN_CONVERSIONS),
  } : null
  const contracts = !salesCrm && hasCrm ? { n: val(kpis, 'contracts'), previousN: val(kpis, 'contracts', 'prev') } : null

  const special = specialDaysIn(cur), prevSpecial = specialDaysIn(prev)
  const shortWindow = (cur?.days ?? 0) < DECISION_WINDOW_DAYS

  const notes = []
  if (!hasCrm) notes.push('אין נתוני CRM לפרויקט — אין פגישות ומכירות, ולכן השיפוט כאן בעיוורון. עלות לליד לבדה לא אומרת אם הפרסום עובד.')
  if (hasCrm && !hasAds) notes.push('אין הוצאת פרסום בתקופה — אי אפשר לחשב עלות לפגישה או למכירה.')
  if (decision && (n ?? 0) < MIN_CONVERSIONS) notes.push(`${decision.name.replace('עלות ל', '')}: ${n ?? 0} בתקופה (n=${n ?? 0}) — פחות מ-${MIN_CONVERSIONS}, ולכן כל מספר כאן הוא אינדיקציה בלבד ולא מסקנה.`)
  if (decision && prevN != null && prevN < MIN_CONVERSIONS && (n ?? 0) >= MIN_CONVERSIONS) notes.push(`בתקופת ההשוואה רק ${prevN} (n=${prevN}) — ההשוואה אינדיקטיבית.`)
  if (shortWindow && cur) notes.push(`התקופה ${cur.days} ימים. החלטות תקציב נשענות על חלון של ${DECISION_WINDOW_DAYS} יום — מכאן רק מגמה למעקב.`)
  if (cur?.partialToday) notes.push('התקופה כוללת את היום, שעוד לא נגמר — היום האחרון חלקי.')
  if (special.length) notes.push(`ימים חריגים בתקופה: ${special.map(s => `${s.label} (${ddmm(s.date)})`).join(', ')}.`)
  if (prevSpecial.length) notes.push(`ימים חריגים בתקופת ההשוואה: ${prevSpecial.map(s => `${s.label} (${ddmm(s.date)})`).join(', ')}.`)
  if (!m?.hasPrev) notes.push('אין תקופת השוואה עם נתונים — אי אפשר לומר מה השתנה.')

  const level = !hasCrm || !hasAds || (decision && (n ?? 0) < 3) ? 'insufficient'
    : notes.length ? 'partial' : 'good'

  return {
    level, notes, hasCrm, hasAds, crmType,
    period: cur, comparisonPeriod: prev, specialDays: special, comparisonSpecialDays: prevSpecial,
    shortWindow, decisionMetric: decision, contracts,
    minConversions: MIN_CONVERSIONS, decisionWindowDays: DECISION_WINDOW_DAYS,
  }
}
