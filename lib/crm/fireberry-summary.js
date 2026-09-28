/**
 * lib/crm/fireberry-summary.js — חישוב שורת דוח CRM מתוך רשומות Fireberry.
 *
 * פונקציה טהורה: אותה פונקציה רצה על משיכה חיה (app/api/fireberry/fetch) ועל תמונת
 * המצב השמורה (lib/crm/compute.js), כדי ששתי הדרכים ייתנו את אותו מספר.
 *
 * ── מבנה הנתונים אצל אלפא ────────────────────────────────────────────────────
 * הליד אצלם הוא רשומת "לקוח" (Account), לא רשומת ליד. הפגישה היא רשומת "פעילות"
 * (Activity) נפרדת שמצביעה על הליד ב-objectid. אין לוג סטטוסים — האובייקט קיים
 * וריק — ולכן אי אפשר לתארך מעברי סטטוס, רק את מצבם הנוכחי.
 *
 * ── הגדרות הספירה ────────────────────────────────────────────────────────────
 *   לידים            = רשומות שנוצרו בתוך הטווח (createdon).
 *   לא רלוונטיים     = סטטוס "לא רלוונטי". רלוונטיים = כל השאר.
 *   תואמו            = פגישות שה*תיאום* שלהן נעשה בטווח (createdon של הפגישה).
 *   בוצעו / בוטלו    = פגישות שה*מועד* שלהן בטווח (scheduledstart) והסטטוס מתאים.
 *
 * ⚠️ "תואמו" נספר לפי מועד התיאום ו"בוצעו" לפי מועד הפגישה — בדיוק כמו ב-BMBY.
 *    זה מכוון: פגישה שתואמה החודש ותתקיים בחודש הבא היא הישג של החודש הזה, והיא
 *    חייבת להעלות את "תואמו" בלי להעלות את "בוצעו".
 *
 * ⚠️ 17 מתוך 25 הפגישות הקיימות (28.9.2026) הן בלי סטטוס כלל — הן פשוט טרם סומנו.
 *    לכן "בוצעו" מונה רק פגישות שסומנו "התקיימה", והוא חסם תחתון ולא אמת מוחלטת.
 *    הספירה לפי סטטוס הליד נשמרת בנפרד ב-byStatus כדי שההפרש יהיה גלוי ולא מוסתר.
 */

/** תווי כיווניות בלתי נראים נדבקים לשמות קמפיין/מודעה שמגיעים ממטא ושוברים השוואות. */
export const clean = (v) => String(v ?? '')
  .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
  .trim()

/** "2026-09-28T12:22:27" → "2026-09-28". Fireberry מחזיר זמן מקומי בלי אזור זמן. */
export const ymd = (v) => {
  const s = String(v ?? '')
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ''
}
const hourOf = (v) => {
  const s = String(v ?? '')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}/.test(s)) return null
  const h = Number(s.slice(11, 13))
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : null
}

const STATUS_IRRELEVANT = 'לא רלוונטי'
const MEETING_HELD = 'התקיימה'
const MEETING_CANCELLED = 'בוטלה'
const NO_SOURCE = 'ללא מקור'

/**
 * סינון לפרויקט. אצל אלפא יושבים כמה פרויקטים באותו CRM, ובתוך "אקספו חיפה"
 * יושבות שתי סוכנויות: "קמפיין השקה ויטאס & AllMarket" (שלנו) ו"קמפיין השקה לאוס".
 * נמדד ב-28.9: 267 הלידים של ויטאס נושאים שמות קמפיין פרסום, ו-51 של לאוס — אף אחד.
 * בלי הסינון השני הדשבורד היה מציג לידים שלא אנחנו הבאנו.
 */
/**
 * אילו פרויקטים ב-Supabase נמשכים מ-Fireberry, ומה הסינון שלהם בתוך ה-CRM.
 * `match` הוא תת-מחרוזת של שם הפרויקט ב-Supabase; `project` ו-`crmCampaign` הם
 * הערכים המדויקים בשדות של Fireberry. לקוח או פרויקט נוסף = שורה אחת כאן.
 *
 * יושב כאן ולא ב-route כדי שהבדיקות יוכלו לייבא אותו בלי לגרור את שכבת ההרשאות.
 */
export const FIREBERRY_PROJECTS = [
  { match: 'אקספו חיפה', project: 'אקספו חיפה', crmCampaign: 'קמפיין השקה ויטאס & AllMarket' },
]
export function fireberryConfigFor(projectName) {
  const n = String(projectName || '').toLowerCase().trim()
  return FIREBERRY_PROJECTS.find(p => n.includes(p.match.toLowerCase())) || null
}

export function filterLeads(leads, { project, crmCampaign } = {}) {
  const p = clean(project), c = clean(crmCampaign)
  return (leads || []).filter((l) => {
    if (!l || typeof l !== 'object') return false
    if (p && clean(l.pcfsystemfield174name) !== p) return false
    if (c && clean(l.campaignname) !== c) return false
    return true
  })
}

// registrations/contracts נשארים בצורה עם אפס: ה-UI וכלי ההשוואה מצפים לצורה אחת
// לכל ה-CRM-ים מסוג נדל"ן, ושדה חסר נקרא שם כ-undefined ולא כ-0. ב-Fireberry של אלפא
// אין הרשמות ואין חוזים — הליד נסגר בסטטוס, ולכן הם תמיד אפס והכרטיסים שלהם מוסתרים.
const emptyBucket = () => ({
  totalLeads: 0, relevantLeads: 0, nonRelevantLeads: 0,
  meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0,
  registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0,
})

/**
 * @param {{leads:any[], meetings:any[]}} raw  רשומות כפי שהתקבלו (כבר מסוננות לפרויקט)
 * @param {{since:string, until:string, now?:Date}} period  YYYY-MM-DD
 */
export function computeFireberrySummary({ leads, meetings }, { since, until, now } = {}) {
  const _now = now || new Date()
  const todayY = ymd(_now.toISOString())
  const inRange = (d) => !!d && d >= since && d <= until
  // פגישה שמועדה בעתיד לא יכולה להיות "בוצעה", גם אם הטווח המבוקש נמשך קדימה.
  const heldUntil = until < todayY ? until : todayY

  const allLeads = (leads || []).filter((l) => l && typeof l === 'object')
  const periodLeads = allLeads.filter((l) => inRange(ymd(l.createdon)))

  // מפה מכל ליד (כולל ישנים) אל התגיות שלו, כדי שפגישה שהתקיימה החודש עבור ליד
  // מחודש שעבר עדיין תשויך למודעה שהביאה אותו.
  const byId = new Map(allLeads.map((l) => [String(l.accountid || ''), l]))

  // meetingsUpcoming: פגישות שכבר תואמו ומועדן עוד לפנינו. הן אינן "בוצעו" ואינן
  // "בוטלו", ובלי הכרטיס הזה הן פשוט נעלמות בין תואמו לבוצעו.
  // leadsToHandle: לידים שעדיין בסטטוס "חדש" — איש עוד לא נגע בהם.
  const totals = { ...emptyBucket(), meetingsUpcoming: 0, leadsToHandle: 0 }
  const sources = {}
  const ensureSrc = (k) => (sources[k] || (sources[k] = emptyBucket()))

  const byStatus = {}
  const byOwner = {}         // מנהל לקוח — הטלמיטינג שקובע פגישות
  const bySalesRep = {}      // איש מכירות — מי שמבצע את הפגישה
  const byLandingPage = {}   // גרסת דף נחיתה
  const bump = (obj, key) => { const k = clean(key) || '—'; obj[k] = (obj[k] || 0) + 1 }

  const hourlyLeadStats = Array(24).fill(0)   // שעת כניסת הליד
  const hourlyApptStats = Array(24).fill(0)   // שעת תיאום הפגישה

  const _adAgg = new Map()
  const adKey = (l) => [
    clean(l.originatingleadcode) || NO_SOURCE,
    clean(l.originatingleadcode) || NO_SOURCE,
    clean(l.pcfsystemfield185), clean(l.pcfsystemfield186), clean(l.pcfsystemfield187),
  ].join('\u0001')
  const nodeFor = (l) => {
    const key = adKey(l)
    let a = _adAgg.get(key)
    if (!a) {
      const source = clean(l.originatingleadcode) || NO_SOURCE
      a = {
        source, platform: source,
        campaign: clean(l.pcfsystemfield185), adset: clean(l.pcfsystemfield186), ad: clean(l.pcfsystemfield187),
        campaignId: clean(l.pcfsystemfield188), adsetId: clean(l.pcfsystemfield189), adId: clean(l.pcfsystemfield190),
        gclid: clean(l.pcfsystemfield193),
        leads: 0, relevantLeads: 0, leadsWithId: 0, gclidLeads: 0,
        meetings: 0, meetingsCompleted: 0, registrations: 0, contracts: 0,
      }
      _adAgg.set(key, a)
    }
    return a
  }

  for (const l of periodLeads) {
    const status = clean(l.statuscode)
    const relevant = status !== STATUS_IRRELEVANT
    const source = clean(l.originatingleadcode) || NO_SOURCE
    const bucket = ensureSrc(source)
    const node = nodeFor(l)

    totals.totalLeads++; bucket.totalLeads++; node.leads++
    if (relevant) { totals.relevantLeads++; bucket.relevantLeads++; node.relevantLeads++ }
    else { totals.nonRelevantLeads++; bucket.nonRelevantLeads++ }
    if (node.adId) node.leadsWithId++
    if (node.gclid) node.gclidLeads++

    if (status === 'חדש') totals.leadsToHandle++
    bump(byStatus, status)
    bump(byOwner, l.ownername)
    bump(bySalesRep, l.pcfsystemfield212name)
    bump(byLandingPage, l.pcfsystemfield210)
    const h = hourOf(l.createdon)
    if (h !== null) hourlyLeadStats[h]++
  }

  // ── פגישות ──────────────────────────────────────────────────────────────────
  // הפגישה מצביעה על הליד ב-objectid. פגישה של ליד שאינו בקבוצה שלנו (פרויקט אחר,
  // סוכנות אחרת) נזרקת כאן — זה השער היחיד, כי אובייקט הפעילות עצמו אינו נושא פרויקט.
  const meetingsByRep = {}
  const completedMeetings = []
  for (const m of (meetings || [])) {
    if (!m || typeof m !== 'object') continue
    const lead = byId.get(String(m.objectid || ''))
    if (!lead) continue
    const node = nodeFor(lead)
    const src = ensureSrc(clean(lead.originatingleadcode) || NO_SOURCE)
    const status = clean(m.statuscode || m.status)
    const coordDay = ymd(m.createdon)        // מתי תואמה
    const meetDay = ymd(m.scheduledstart)    // מתי אמורה להתקיים

    if (inRange(coordDay)) {
      totals.meetingsScheduled++; src.meetingsScheduled++; node.meetings++
      bump(meetingsByRep, m.ownername)
      const h = hourOf(m.createdon)
      if (h !== null) hourlyApptStats[h]++
    }
    if (meetDay && meetDay >= since && meetDay <= heldUntil) {
      if (status === MEETING_HELD) {
        totals.meetingsCompleted++; src.meetingsCompleted++; node.meetingsCompleted++
        completedMeetings.push({
          name: clean(lead.accountname) || clean(m.objecttitle),
          source: clean(lead.originatingleadcode) || NO_SOURCE,
          rep: clean(m.ownername), date: meetDay,
        })
      } else if (status === MEETING_CANCELLED) {
        totals.meetingsCancelled++; src.meetingsCancelled++
      }
    }
    // עתידית = תואמה (בטווח) ומועדה עוד לא הגיע, ולא בוטלה.
    if (inRange(coordDay) && meetDay && meetDay > todayY && status !== MEETING_CANCELLED) totals.meetingsUpcoming++
  }

  // שורות ה-Excel — מה שהלקוח מוריד. בלי טלפון ובלי מייל: הדוח הזה נצפה גם בצד
  // הלקוח, וה-PII לא צריך לעבור דרך טבלת reports כדי להציג יחסי המרה.
  const xlsxRows = periodLeads.map((l) => ({
    'שם לקוח': clean(l.accountname),
    'תאריך כניסה': ymd(l.createdon),
    'סטטוס': clean(l.statuscode),
    'מקור הגעה': clean(l.originatingleadcode) || NO_SOURCE,
    'מנהל לקוח': clean(l.ownername),
    'איש מכירות': clean(l.pcfsystemfield212name),
    'הערה': clean(l.pcfsystemfield182),
    'מאשר דיוור': clean(l.pcfsystemfield184name),
    'שם קמפיין': clean(l.pcfsystemfield185),
    'שם קהל': clean(l.pcfsystemfield186),
    'שם מודעה': clean(l.pcfsystemfield187),
    'גרסת דף נחיתה': clean(l.pcfsystemfield210),
  }))

  return {
    xlsxRows,
    totals,
    sources,
    adBreakdown: [..._adAgg.values()],
    byStatus, byOwner, bySalesRep, byLandingPage, meetingsByRep,
    hourlyLeadStats, hourlyApptStats,
    completedMeetings,
    periodLeads,
  }
}

/** אותה עטיפה כמו toReportRow של BMBY: הצורה שנשמרת ב-reports ונקראת ב-UI. */
export function toReportRow(R) {
  return {
    data: R.xlsxRows,
    summary: {
      // crmType מנתב את ה-UI. 'fireberry' נופל לפריסת הנדל"ן (כמו BMBY) — לידים,
      // רלוונטיים, ומשפך הפגישות — בלי כרטיסי ההרשמות והחוזים שאין להם מקור כאן.
      crmType: 'fireberry',
      ...R.totals,
      sources: R.sources,
      adBreakdown: R.adBreakdown,
      byStatus: R.byStatus,
      byOwner: R.byOwner,
      bySalesRep: R.bySalesRep,
      byLandingPage: R.byLandingPage,
      meetingsByRep: R.meetingsByRep,
      hourlyLeadStats: R.hourlyLeadStats,
      hourlyApptStats: R.hourlyApptStats,
      completedMeetings: R.completedMeetings,
      // ⚠️ אין כאן hourlyContactStats (שעת הטיפול בליד) בכוונה: לוג השיחה ב-Fireberry
      //    של אלפא ריק (4 רשומות בכל החשבון, אפס לאקספו), ואין שדה אחר שמתעד מתי
      //    נגעו בליד. גרף ריק היה נראה כמו "לא טיפלו" במקום "אין נתון".
    },
    row_count: R.periodLeads.length,
  }
}
