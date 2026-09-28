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

import { businessMinutesBetween } from '../business-hours.js'

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
// ── זמני תגובה מתוך ההערות ──────────────────────────────────────────────────
//
// "תגובה" = ההערה האנושית הראשונה על הליד אחרי שנכנס. שלוש הערות אינן אנושיות,
// ונמדד ב-28.9 שהן מופיעות בכל ליד של אלפא:
//   • שתי הערות ברגע היצירה (+0.0 דקות) שהטקסט שלהן הוא שם הליד — האוטומציה
//     שיוצרת את הרשומה.
//   • הערה שהטקסט שלה הוא מספר טלפון בלבד ("0537618235") — אוטומציית הודעה.
// אם סופרים אותן, כל ליד "נענה תוך 0 דקות" והמסך משקר. מי שכתב לא משנה: "משי
// אלפא" היא גם משתמשת האוטומציה וגם בעלת לידים, ולכן הסינון לפי תוכן ולא לפי שם.
const PHONE_ONLY = /^[+\d][\d\s\-()]{6,}$/
export function isHumanNote(note, lead) {
  const t = clean(note?.text)
  if (!t) return false
  if (t === clean(lead?.accountname)) return false
  if (PHONE_ONLY.test(t)) return false
  return true
}

const parseTs = (s) => new Date(String(s || '').replace(' ', 'T')).getTime()
const BUCKET_KEYS = ['0-15m', '15m-1h', '1h-4h', '4h-8h', '8h-1d', '1d-3d', '3d+']
const bucketOf = (mn) => mn <= 15 ? '0-15m' : mn <= 60 ? '15m-1h' : mn <= 240 ? '1h-4h' : mn <= 480 ? '4h-8h' : mn <= 1440 ? '8h-1d' : mn <= 4320 ? '1d-3d' : '3d+'

/**
 * אותה צורה בדיוק של responseTimeStats ב-bmby-summary.js — מסך "זמני תגובה" קורא
 * אותה כמו שהיא. החישוב שם כתוב בתוך הפונקציה הגדולה ולא כפונקציה נפרדת, ולכן
 * הוא משוכפל כאן; שינוי בצורה שם מחייב שינוי גם כאן.
 */
function computeResponseStats(periodLeads, notesByLead, scheduledOf) {
  const hourlyContactStats = Array(24).fill(0)
  const hourlyContactMeeting = Array(24).fill(0)
  const noAnswerContactHour = Array(24).fill(0)
  const rows = []
  for (const l of periodLeads) {
    const id = String(l.accountid || '')
    const lidMs = parseTs(l.createdon)
    if (!id || isNaN(lidMs)) continue
    const source = clean(l.originatingleadcode) || NO_SOURCE
    const first = (notesByLead.get(id) || [])
      .filter(n => isHumanNote(n, l) && parseTs(n.createdon) >= lidMs)
      .sort((a, b) => parseTs(a.createdon) - parseTs(b.createdon))[0]
    if (!first) { rows.push({ source, noResponse: true, owner: clean(l.ownername) || null }); continue }
    const firstMs = parseTs(first.createdon)
    const scheduled = scheduledOf(l)
    const h = hourOf(first.createdon)
    if (h !== null) {
      hourlyContactStats[h]++
      if (scheduled) hourlyContactMeeting[h]++
      if (/אין מענה/.test(first.text)) noAnswerContactHour[h]++
    }
    rows.push({
      source, noResponse: false, scheduledMeeting: scheduled,
      firstUser: clean(first.by) || 'לא ידוע',
      responseMinutes: Math.max(0, Math.round((firstMs - lidMs) / 60000)),
      businessMinutes: businessMinutesBetween(lidMs, firstMs),
    })
  }
  const responded = rows.filter(r => !r.noResponse)
  const noResponseBySource = {}, noResponseByUser = {}
  for (const r of rows) {
    if (!r.noResponse) continue
    noResponseBySource[r.source] = (noResponseBySource[r.source] || 0) + 1
    if (r.owner) noResponseByUser[r.owner] = (noResponseByUser[r.owner] || 0) + 1
  }
  const aggStats = (key) => {
    const mins = responded.map(r => r[key]).sort((a, b) => a - b)
    const buckets = Object.fromEntries(BUCKET_KEYS.map(k => [k, 0]))
    const bucketsWithMeeting = Object.fromEntries(BUCKET_KEYS.map(k => [k, { total: 0, withMeeting: 0 }]))
    for (const r of responded) {
      const b = bucketOf(r[key])
      buckets[b]++
      bucketsWithMeeting[b].total++
      if (r.scheduledMeeting) bucketsWithMeeting[b].withMeeting++
    }
    const by = (field) => {
      const g = {}
      for (const r of responded) (g[r[field] || 'לא ידוע'] ||= []).push(r[key])
      return Object.fromEntries(Object.entries(g).map(([k, arr]) => {
        const s = [...arr].sort((a, b) => a - b)
        return [k, { count: arr.length, avgMinutes: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length), medianMinutes: s[Math.floor(s.length / 2)] }]
      }))
    }
    return {
      avgMinutes: mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : 0,
      medianMinutes: mins.length ? mins[Math.floor(mins.length / 2)] : 0,
      p90Minutes: mins.length ? mins[Math.floor(mins.length * 0.9)] : 0,
      buckets, bucketsWithMeeting,
      bySource: by('source'), byUser: by('firstUser'),
    }
  }
  return {
    responseTimeStats: {
      totalLids: rows.length,
      respondedCount: responded.length,
      noResponseCount: rows.length - responded.length,
      noResponseBySource, noResponseByUser,
      ...aggStats('responseMinutes'),
      business: aggStats('businessMinutes'),
    },
    hourlyContactStats, hourlyContactMeeting, noAnswerContactHour,
  }
}

const DOW_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

const emptyBucket = () => ({
  totalLeads: 0, relevantLeads: 0, nonRelevantLeads: 0,
  meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0,
  registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0,
})

/**
 * @param {{leads:any[], meetings:any[]}} raw  רשומות כפי שהתקבלו (כבר מסוננות לפרויקט)
 * @param {{since:string, until:string, now?:Date}} period  YYYY-MM-DD
 */
export function computeFireberrySummary({ leads, meetings, notes }, { since, until, now } = {}) {
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
        // אותה צורה של BMBY, כי הטבלה בתת-הטאב "פגישות שבוצעו" קוראת בדיוק את
        // השדות האלה: name, phone, source, date, description. בלי phone ו-description
        // השורות הוצגו עם שני מקפים — נראו ריקות למרות שהפגישה נספרה.
        // "תיאור" מרכיב את מה שיש: מי ביצע, סיכום הפגישה, והערת איש המכירות על הליד.
        // ⚠️ אין cid בכוונה: cid פותח בלחיצה את היסטוריית ההערות דרך /api/bmby/lead-notes,
        //    ולליד של Fireberry הוא היה פונה ל-BMBY עם מזהה שלא קיים שם.
        const desc = [
          clean(m.ownername) ? 'נציג: ' + clean(m.ownername) : '',
          clean(m.description),
          clean(lead.pcfsystemfield182),
        ].filter(Boolean).join(' · ')
        const _t = String(m.scheduledstart || '')
        completedMeetings.push({
          name: clean(lead.accountname) || clean(m.objecttitle),
          phone: clean(lead.telephone1),
          source: clean(lead.originatingleadcode) || NO_SOURCE,
          rep: clean(m.ownername),
          date: /T\d{2}:\d{2}/.test(_t) ? _t.slice(0, 10) + ' ' + _t.slice(11, 16) : meetDay,
          description: desc,
        })
      } else if (status === MEETING_CANCELLED) {
        totals.meetingsCancelled++; src.meetingsCancelled++
      }
    }
    // עתידית = תואמה (בטווח) ומועדה עוד לא הגיע, ולא בוטלה.
    if (inRange(coordDay) && meetDay && meetDay > todayY && status !== MEETING_CANCELLED) totals.meetingsUpcoming++
  }

  // ── namedLeads: המשפך בטאב "הכל" ─────────────────────────────────────────────
  // renderFunnelBar (admin/page.js) בונה את התחנות מאורכי הרשימות האלה, לכל ערוץ בנפרד,
  // ופותח אותן כרשימת שמות בלחיצה. זו אותה צורה בדיוק של BMBY. בלעדיה כל התחנות מתחת
  // לקליקים הציגו "אין נתון" — ה-KPI למעלה היו מלאים, והמשפך ריק.
  //
  // המשפך הוא קוהורט: הלידים שנכנסו בתקופה, ומה קרה *להם*. לכן כאן נספרים לידים
  // (ליד עם שתי פגישות = 1), בשונה מהכרטיסים שסופרים פגישות.
  //
  // registrations ו-contracts חסרים בכוונה: רשימה ריקה הייתה מוצגת כ-0, ו"אין נתון"
  // הוא האמת — אין להם מקור ב-Fireberry של אלפא.
  const NO_CONTACT = new Set(['חדש', 'אין מענה'])
  const LEAD_SCHED = new Set(['תואמה פגישה', 'התקיימה פגישה', 'בוטלה פגישה', 'לקוח סגר'])
  const meetStatusByLead = new Map()   // accountid → Set(סטטוסי פגישות)
  const firstMeetByLead = new Map()    // accountid → מועד הפגישה הראשונה
  for (const m of (meetings || [])) {
    const id = String(m?.objectid || '')
    if (!id) continue
    if (!meetStatusByLead.has(id)) meetStatusByLead.set(id, new Set())
    meetStatusByLead.get(id).add(clean(m.statuscode || m.status))
    const d = ymd(m.scheduledstart)
    if (d && (!firstMeetByLead.has(id) || d < firstMeetByLead.get(id))) firstMeetByLead.set(id, d)
  }
  const entry = (l) => {
    const id = String(l.accountid || '')
    const e = { name: clean(l.accountname) || 'ליד', source: clean(l.originatingleadcode) || NO_SOURCE }
    const ld = ymd(l.createdon); if (ld) e.leadDate = ld
    const ad = firstMeetByLead.get(id); if (ad) e.apptDate = ad
    return e
  }
  const buildGroup = (list) => {
    const g = { allLeads: [], noResponse: [], meetingsScheduled: [], meetingsCompleted: [], meetingsCancelled: [] }
    for (const l of list) {
      const id = String(l.accountid || '')
      const st = clean(l.statuscode)
      const ms = meetStatusByLead.get(id) || new Set()
      const e = entry(l)
      g.allLeads.push(e)
      if (NO_CONTACT.has(st)) g.noResponse.push(e)
      if (ms.size > 0 || LEAD_SCHED.has(st)) g.meetingsScheduled.push(e)
      if (ms.has(MEETING_HELD) || st === 'התקיימה פגישה') g.meetingsCompleted.push(e)
      if (ms.has(MEETING_CANCELLED) || st === 'בוטלה פגישה') g.meetingsCancelled.push(e)
    }
    return g
  }
  const srcIs = (name) => (l) => clean(l.originatingleadcode) === name
  const namedLeads = {
    all: buildGroup(periodLeads),
    facebook: buildGroup(periodLeads.filter(srcIs('פייסבוק'))),
    google: buildGroup(periodLeads.filter(srcIs('גוגל'))),
  }

  // ── זמני תגובה ויום בשבוע ─────────────────────────────────────────────────────
  // בלי הערות (לפני שהסנכרון הראשון רץ) אין על מה לחשב — מחזירים null ולא אפסים,
  // כדי שהמסך יציג "אין נתון" ולא "0 לידים נענו".
  const notesByLead = new Map()
  for (const n of (notes || [])) {
    const id = String(n?.objectid || '')
    if (id) (notesByLead.get(id) || notesByLead.set(id, []).get(id)).push(n)
  }
  const scheduledOf = (l) => {
    const ms = meetStatusByLead.get(String(l.accountid || '')) || new Set()
    return [...ms].some(s => s !== MEETING_CANCELLED) || LEAD_SCHED.has(clean(l.statuscode))
  }
  const resp = notesByLead.size > 0 ? computeResponseStats(periodLeads, notesByLead, scheduledOf) : null
  const dayOfWeekStats = Object.fromEntries(DOW_NAMES.map((name, i) => [i, { name, leads: 0, scheduled: 0 }]))
  for (const l of periodLeads) {
    const d = new Date(String(l.createdon || '').replace(' ', 'T'))
    if (isNaN(d.getTime())) continue
    dayOfWeekStats[d.getDay()].leads++
    if (scheduledOf(l)) dayOfWeekStats[d.getDay()].scheduled++
  }

  // ── שורות הדוח (reports.data): שורה לכל מקור הגעה, בצורה של BMBY ────────────
  //
  // ⚠️ עד 28.9 כאן הייתה שורה לכל ליד, עם כותרות בעברית. אבל מסך "CRM › מקורות
  //    הגעה" מחשב את הכרטיסים ואת טבלת המקורות מחדש מתוך data, דרך aggregateCrmRows
  //    (lib/helpers.js) — והיא קוראת row.source, row.totalLeads, row.meetingsScheduled.
  //    כל שורה החזירה אפס, והמסך הציג 0 רלוונטיים, 0 פגישות, ורק את 57 לידי גוגל
  //    שהוא מוסיף בעצמו מפלטפורמת הפרסום.
  //
  // `leads` בכל שורה הם הלידים של אותו מקור, לתצוגה בלחיצה. השדות הם אלה שוויטלי
  // מנה כחשובים אצל אלפא (28.9). בלי טלפון ובלי מייל — זה לא נדרש לתצוגת מקורות.
  const bySrcRows = new Map()
  for (const l of periodLeads) {
    const src = clean(l.originatingleadcode) || NO_SOURCE
    if (!bySrcRows.has(src)) bySrcRows.set(src, { source: src, ...emptyBucket(), irrelevantLeads: 0, leads: [] })
    const row = bySrcRows.get(src)
    const b = sources[src] || emptyBucket()
    Object.assign(row, {
      totalLeads: b.totalLeads, relevantLeads: b.relevantLeads,
      irrelevantLeads: b.nonRelevantLeads, nonRelevantLeads: b.nonRelevantLeads,
      meetingsScheduled: b.meetingsScheduled, meetingsCompleted: b.meetingsCompleted, meetingsCancelled: b.meetingsCancelled,
    })
    const st = clean(l.statuscode)
    row.leads.push({
      name: clean(l.accountname) || 'ליד',
      date: ymd(l.createdon),
      status: st,
      relevant: st !== STATUS_IRRELEVANT,
      lastNote: clean(l.pcfsystemfield182),
      owner: clean(l.ownername),
      salesRep: clean(l.pcfsystemfield212name),
      mailingOptIn: clean(l.pcfsystemfield184name),
      campaign: clean(l.pcfsystemfield185),
      adset: clean(l.pcfsystemfield186),
      ad: clean(l.pcfsystemfield187),
      landingPage: clean(l.pcfsystemfield210),
    })
  }
  // פגישות של לידים ישנים (שנכנסו לפני התקופה) נספרות במקור שלהם גם אם אין לו
  // לידים חדשים בתקופה — אחרת הן היו נעלמות מהטבלה ומופיעות רק בסך הכל.
  for (const [src, b] of Object.entries(sources)) {
    if (bySrcRows.has(src)) continue
    if (!(b.meetingsScheduled || b.meetingsCompleted || b.meetingsCancelled)) continue
    bySrcRows.set(src, { source: src, ...b, irrelevantLeads: b.nonRelevantLeads, leads: [] })
  }
  const sourceRows = [...bySrcRows.values()].sort((a, b) => b.totalLeads - a.totalLeads)

  return {
    sourceRows,
    totals,
    sources,
    adBreakdown: [..._adAgg.values()],
    byStatus, byOwner, bySalesRep, byLandingPage, meetingsByRep,
    hourlyLeadStats, hourlyApptStats,
    completedMeetings,
    namedLeads,
    dayOfWeekStats,
    responseTimeStats: resp?.responseTimeStats || null,
    hourlyContactStats: resp?.hourlyContactStats || null,
    hourlyContactMeeting: resp?.hourlyContactMeeting || null,
    noAnswerContactHour: resp?.noAnswerContactHour || null,
    periodLeads,
  }
}

/** אותה עטיפה כמו toReportRow של BMBY: הצורה שנשמרת ב-reports ונקראת ב-UI. */
export function toReportRow(R) {
  return {
    data: R.sourceRows,
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
      namedLeads: R.namedLeads,
      dayOfWeekStats: R.dayOfWeekStats,
      // זמני תגובה ושעות טיפול — מההערות (ראה computeResponseStats). כשאין עדיין
      // הערות מסונכרנות השדות חסרים לגמרי, והמסך מציג "אין נתון" ולא אפסים.
      //
      // ⚠️ תיקון (28.9): בגרסה הראשונה כתבתי כאן שאין מקור לזמני תגובה, כי לוג
      //    השיחה ריק. זה היה שגוי — ההיסטוריה יושבת באובייקט ההערות, שלא מצאתי כי
      //    חיפשתי /notes ברבים. ויטלי הצביע על ליד עם הערות מתוארכות.
      ...(R.responseTimeStats ? {
        responseTimeStats: R.responseTimeStats,
        hourlyContactStats: R.hourlyContactStats,
        hourlyContactMeeting: R.hourlyContactMeeting,
        noAnswerContactHour: R.noAnswerContactHour,
      } : {}),
    },
    row_count: R.periodLeads.length,
  }
}
