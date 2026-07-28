/**
 * scripts/demo/synthesize.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * מנוע הסינתזה של פרויקט הדמו.
 *
 * הרעיון המרכזי: במקום "לקחת נתון אמיתי ולהחליף בו שמות" (שמשאיר תמיד סיכון
 * שדה שנשכח), אנחנו **בונים מאפס רוסטר של לידים סינתטיים** לפי הפרופיל
 * המספרי, ואז מחשבים ממנו את כל הצברים בדיוק כמו ש-`app/api/bmby/fetch`
 * מחשב אותם מהנתון האמיתי.
 *
 * תוצאה: אין שום מסלול שדרכו מחרוזת אמיתית יכולה להגיע לדמו, וכל אילוצי
 * השלמות (§4.4 באפיון) מתקיימים **בבנייה** ולא בתיקון בדיעבד.
 *
 * דטרמיניזם מלא: PRNG עם seed קבוע → אותו פלט בדיוק בכל הרצה, לנצח.
 */

import {
  DEMO, SALESPEOPLE, FIRST_NAMES, LAST_NAMES, PHONE_PREFIXES, PHONE_BLOCK,
  SOURCE_LABELS, CITIES, OBJECTIONS, MEETING_NOTES,
  FB_CAMPAIGNS, FB_ADSETS, FB_ADS, FB_AD_TEXTS,
  GOOGLE_CAMPAIGNS, GOOGLE_ADGROUPS, GOOGLE_AD_TEXTS, ASSET_GROUP_NAMES,
  DEMO_CREATIVES,
} from './dictionaries.mjs'

export const CRM_SCHEMA_VERSION = 14   // v14: hourlyContactStats + hourlyContactMeeting
export const GOOGLE_SCHEMA_VERSION = 1

// ═══════════════════════════════════════════════════════════════════════════
// עזרי דטרמיניזם
// ═══════════════════════════════════════════════════════════════════════════

/** mulberry32 — PRNG קטן, מהיר ודטרמיניסטי. */
function makeRng(seed) {
  let a = seed >>> 0
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** בחירה משוקללת מתוך מערך. */
function weightedPick(rng, items, weights) {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

/** חלוקת סכום שלם למכסות לפי משקלים, כך שהסכום נשמר בדיוק (Largest Remainder). */
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0) return weights.map(() => 0)
  const raw   = weights.map(w => (total * w) / sum)
  const floor = raw.map(Math.floor)
  let left    = total - floor.reduce((a, b) => a + b, 0)
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
  for (let k = 0; k < left; k++) floor[order[k % order.length].i]++
  return floor
}

/** חלוקת סכום עשרוני לפי משקלים (לכסף/חשיפות). */
function allocateFloat(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0) return weights.map(() => 0)
  return weights.map(w => (total * w) / sum)
}

/** ערבוב דטרמיניסטי (Fisher-Yates עם ה-PRNG). */
function shuffle(rng, arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// ═══════════════════════════════════════════════════════════════════════════
// מחוללי זהות
// ═══════════════════════════════════════════════════════════════════════════

/**
 * מחולל שמות ייחודיים. שומר מאגר של צירופים שכבר נוצלו כדי שלא יופיעו
 * שני לידים עם אותו שם (מה שהיה שובר את מודאלי השמות).
 */
function makeNameGen(rng) {
  const used = new Set()
  return function nextName() {
    for (let attempt = 0; attempt < 500; attempt++) {
      const n = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)] + ' ' +
                LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)]
      if (!used.has(n)) { used.add(n); return n }
    }
    // גיבוי: מאגר מיצה את עצמו — מוסיפים סיפרה מבדלת
    let i = 2
    while (true) {
      const n = FIRST_NAMES[0] + ' ' + LAST_NAMES[0] + ' ' + i
      if (!used.has(n)) { used.add(n); return n }
      i++
    }
  }
}

/** מחולל טלפונים בתוך טווח דמו שאינו מוקצה למנויים אמיתיים. */
function makePhoneGen(rng) {
  let counter = 0
  return function nextPhone() {
    const prefix = PHONE_PREFIXES[Math.floor(rng() * PHONE_PREFIXES.length)]
    const tail   = String(counter++ % 1000).padStart(3, '0')
    return `${prefix}-${PHONE_BLOCK}${tail}`
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// בניית רוסטר הלידים
// ═══════════════════════════════════════════════════════════════════════════

const BUCKET_KEYS = ['0-15m', '15m-1h', '1h-4h', '4h-8h', '8h-1d', '1d-3d', '3d+']
/** נקודת אמצע (בדקות) של כל דלי — לדגימת זמן תגובה בתוך הדלי. */
// הדלי האחרון נחתך ב-4 ימים (ולא ב-7 כמו במציאות) — זנב ארוך מדי מושך את
// "זמן מענה ממוצע" בכרטיס ה-KPI למספר שנראה לא אמין בהדגמה.
const BUCKET_RANGES = [[1, 15], [16, 60], [61, 240], [241, 480], [481, 1440], [1441, 4320], [4321, 5760]]

/**
 * בונה רוסטר של N לידים סינתטיים לתקופה נתונה.
 * כל האילוצים נאכפים כאן, ולכן כל הצברים שייגזרו ממנו עקביים בהכרח.
 */
function buildRoster(profile, period, dateRange, rng) {
  const c = period.crm
  const N = c.totalLeads

  const nextName  = makeNameGen(rng)
  const nextPhone = makePhoneGen(rng)

  const sourceNames   = Object.keys(profile.sourceMix)
  const sourceWeights = sourceNames.map(k => profile.sourceMix[k])

  // ── חלוקה מדויקת לפי מכסות (ולא הגרלה חופשית) ────────────────────────
  // כך `sources` יסתכם תמיד בדיוק ל-totalLeads, ללא סטיית עיגול.
  const perSource = allocate(N, sourceWeights)
  const perDow    = allocate(N, profile.dayOfWeekWeights)
  const perHour   = allocate(N, profile.hourlyLeadWeights)
  const perUser   = allocate(N, profile.salespeopleShare)
  const perCity   = allocate(N, profile.cityWeights)

  const sourceSeq = shuffle(rng, sourceNames.flatMap((s, i) => Array(perSource[i]).fill(s)))
  const dowSeq    = shuffle(rng, perDow.flatMap((n, i) => Array(n).fill(i)))
  const hourSeq   = shuffle(rng, perHour.flatMap((n, i) => Array(n).fill(i)))
  const userSeq   = shuffle(rng, SALESPEOPLE.flatMap((u, i) => Array(perUser[i]).fill(u)))
  const citySeq   = shuffle(rng, CITIES.flatMap((c2, i) => Array(perCity[i]).fill(c2)))

  const leads = []
  for (let i = 0; i < N; i++) {
    leads.push({
      idx: i,
      name: nextName(),
      phone: nextPhone(),
      source: sourceSeq[i],
      user: userSeq[i],
      dow: dowSeq[i],
      hour: hourSeq[i],
      city: citySeq[i],
      relevant: false,
      responded: false,
      responseMinutes: 0,
      businessMinutes: 0,
      scheduled: false,
      completed: false,
      cancelled: false,
      registration: false,
      contract: false,
      contractValue: 0,
      registrationValue: 0,
      objection: '',
      leadDate: null,
      meetingDate: null,
      meetingNote: '',
    })
  }

  // ── תאריכי ליד: פיזור אחיד על פני התקופה ─────────────────────────────
  const { start, end } = dateRange
  const spanMs = end.getTime() - start.getTime()
  leads.forEach((l, i) => {
    const d = new Date(start.getTime() + Math.floor((spanMs * (i + 0.5)) / N))
    d.setHours(l.hour, Math.floor(rng() * 60), 0, 0)
    l.leadDate = d
  })

  // ── רלוונטיות: מוטית לפי איכות המקור ────────────────────────────────
  // דירוג לפי ציון = פקטור-איכות-המקור × רעש, ואז חיתוך במכסה הגלובלית.
  // כך הסכום הכולל מדויק, אבל מקור חלש מקבל שיעור לא-רלוונטיים גבוה —
  // וזה מה שמפעיל את המלצת "מקור ששורף תקציב".
  const relevantCount = Math.round(N * c.relevantShare)
  const relFactor = profile.sourceRelevanceFactor || {}
  leads
    .map(l => ({ l, score: (relFactor[l.source] ?? 1) * (0.35 + rng()) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, relevantCount)
    .forEach(({ l }) => { l.relevant = true })

  // ── מענה + זמן תגובה ─────────────────────────────────────────────────
  const respondedCount = Math.round(N * c.respondedShare)
  const respondedSet   = shuffle(rng, leads).slice(0, respondedCount)
  respondedSet.forEach(l => { l.responded = true })

  // חלוקת המשיבים לדליי זמן תגובה לפי המשקלים בפרופיל
  const perBucket = allocate(respondedCount, profile.responseBucketWeights)
  const bucketSeq = shuffle(rng, perBucket.flatMap((n, i) => Array(n).fill(i)))
  const speedByUser = {}
  SALESPEOPLE.forEach((u, i) => { speedByUser[u] = profile.salespeopleSpeedFactor[i] ?? 1 })

  respondedSet.forEach((l, i) => {
    const b = bucketSeq[i]
    const [lo, hi] = BUCKET_RANGES[b]
    const raw = lo + rng() * (hi - lo)
    // מכפיל המהירות של איש המכירות — יוצר את הפער שמנוע ההמלצות מזהה
    const f = speedByUser[l.user] || 1
    l.responseMinutes = Math.max(1, Math.round(raw * f))
    // "שעות עסקים" תמיד קצר או שווה לזמן הרציף
    l.businessMinutes = Math.max(1, Math.round(l.responseMinutes * (c.avgBusinessMinutes / c.avgResponseMinutes)))
    l._bucket = b
  })

  // ── פגישות שתואמו ────────────────────────────────────────────────────
  // מוטות לטובת מענה מהיר וימים חזקים — כדי שהסיפור ש"זמן תגובה משפיע על
  // המרה" יהיה נכון בנתונים עצמם, ולא רק בטקסט ההמלצה.
  const scheduledCount = Math.round(N * c.meetingScheduledRate)
  const cityIndex = new Map(CITIES.map((c2, i) => [c2, i]))
  const scored = leads.map(l => {
    const speedScore = l.responded ? ((profile.speedConvFactor || [])[l._bucket ?? 6] ?? 0.03) : 0.02
    const dowScore   = profile.dayOfWeekConvFactor[l.dow] ?? 1
    const cityScore  = (profile.cityConvFactor || [])[cityIndex.get(l.city) ?? -1] ?? 1
    const relScore   = l.relevant ? 1 : 0.15
    return { l, score: speedScore * dowScore * cityScore * relScore * (0.75 + rng() * 0.5) }
  }).sort((a, b) => b.score - a.score)

  const scheduledLeads = scored.slice(0, scheduledCount).map(s => s.l)
  scheduledLeads.forEach(l => { l.scheduled = true })

  // תאריך + תיאור פגישה
  scheduledLeads.forEach(l => {
    const md = new Date(l.leadDate.getTime() + Math.floor((2 + rng() * 12) * 86400000))
    // הפגישה לא יכולה לחרוג מסוף התקופה
    l.meetingDate = md > end ? new Date(end.getTime() - Math.floor(rng() * 86400000)) : md
    l.meetingDate.setHours(9 + Math.floor(rng() * 9), rng() < 0.5 ? 0 : 30, 0, 0)
    l.meetingNote = MEETING_NOTES[Math.floor(rng() * MEETING_NOTES.length)]
  })

  const completedCount = Math.round(scheduledCount * c.meetingCompletedRate)
  const cancelledCount = Math.round(scheduledCount * c.meetingCancelledRate)
  const shuffledSched  = shuffle(rng, scheduledLeads)
  shuffledSched.slice(0, completedCount).forEach(l => { l.completed = true })
  shuffledSched.slice(completedCount, completedCount + cancelledCount).forEach(l => { l.cancelled = true })

  // ── הרשמות וחוזים (תמיד מתוך מי שהגיע לפגישה שבוצעה) ─────────────────
  const registrationCount = Math.round(N * c.registrationRate)
  const regPool = shuffle(rng, shuffledSched.filter(l => l.completed))
  const regLeads = regPool.slice(0, registrationCount)
  regLeads.forEach(l => {
    l.registration = true
    l.registrationValue = Math.round((c.avgRegistrationValue * (0.86 + rng() * 0.30)) / 5000) * 5000
  })
  const contractCount = Math.round(registrationCount * c.contractRate)
  shuffle(rng, regLeads).slice(0, contractCount).forEach(l => {
    l.contract = true
    l.contractValue = Math.round((c.avgContractValue * (0.88 + rng() * 0.26)) / 5000) * 5000
  })

  // ── התנגדויות: רק ללידים שלא הגיעו לחוזה ─────────────────────────────
  const objPool = leads.filter(l => !l.contract)
  const objCount = Math.round(objPool.length * 0.62)
  shuffle(rng, objPool).slice(0, objCount).forEach(l => {
    l.objection = weightedPick(rng, OBJECTIONS, profile.objectionWeights)
  })

  // ── "ללא מענה" ───────────────────────────────────────────────────────
  const noRespCount = Math.round(N * c.noResponseRate)
  shuffle(rng, leads.filter(l => !l.responded))
    .concat(shuffle(rng, leads.filter(l => l.responded && !l.scheduled)))
    .slice(0, noRespCount)
    .forEach(l => { l.noResponse = true })

  // ── שעת תיאום הפגישה (לגרף "שעות תיאום פגישות") ──────────────────────
  const apptHours = allocate(scheduledCount, profile.hourlyApptWeights)
  const apptHourSeq = shuffle(rng, apptHours.flatMap((n, i) => Array(n).fill(i)))
  scheduledLeads.forEach((l, i) => { l.apptHour = apptHourSeq[i] })

  return leads
}

// ═══════════════════════════════════════════════════════════════════════════
// גזירת summary של CRM מהרוסטר
// ═══════════════════════════════════════════════════════════════════════════

const isFbSource = (s) => /פייסבוק|facebook/i.test(s)
const isGlSource = (s) => /גוגל|google|pmax|search/i.test(s)

function buildNamedLeadsGroup(subset) {
  return {
    allLeads:          subset.map(l => l.name),
    meetingsScheduled: subset.filter(l => l.scheduled).map(l => l.name),
    meetingsCompleted: subset.filter(l => l.completed).map(l => l.name),
    registrations:     subset.filter(l => l.registration).map(l => l.name),
    contracts:         subset.filter(l => l.contract)
                             .map(l => `${l.name} (₪${l.contractValue.toLocaleString('he-IL')})`),
    noResponse:        subset.filter(l => l.noResponse).map(l => l.name),
  }
}

function buildResponseTimeStats(leads) {
  const responded = leads.filter(l => l.responded)
  const noResponseCount = leads.length - responded.length

  const bucketOf = (mn) => {
    if (mn <= 15) return '0-15m'
    if (mn <= 60) return '15m-1h'
    if (mn <= 240) return '1h-4h'
    if (mn <= 480) return '4h-8h'
    if (mn <= 1440) return '8h-1d'
    if (mn <= 4320) return '1d-3d'
    return '3d+'
  }

  const aggStats = (valKey) => {
    const mins = responded.map(r => r[valKey]).sort((a, b) => a - b)
    const sum = mins.reduce((a, b) => a + b, 0)
    const buckets = {}
    for (const k of BUCKET_KEYS) buckets[k] = 0
    for (const mn of mins) buckets[bucketOf(mn)]++

    const bucketsWithMeeting = {}
    for (const k of BUCKET_KEYS) bucketsWithMeeting[k] = { total: 0, withMeeting: 0 }
    for (const r of responded) {
      const b = bucketOf(r[valKey])
      bucketsWithMeeting[b].total++
      if (r.scheduled) bucketsWithMeeting[b].withMeeting++
    }

    const aggregateBy = (key) => {
      const groups = {}
      for (const r of responded) {
        const k = r[key] || 'לא ידוע'
        ;(groups[k] = groups[k] || []).push(r[valKey])
      }
      const out = {}
      for (const [k, arr] of Object.entries(groups)) {
        const s = [...arr].sort((a, b) => a - b)
        out[k] = {
          count: arr.length,
          avgMinutes: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
          medianMinutes: s[Math.floor(s.length / 2)],
        }
      }
      return out
    }

    return {
      avgMinutes:    mins.length ? Math.round(sum / mins.length) : 0,
      medianMinutes: mins.length ? mins[Math.floor(mins.length / 2)] : 0,
      p90Minutes:    mins.length ? mins[Math.floor(mins.length * 0.9)] : 0,
      buckets,
      bucketsWithMeeting,
      bySource: aggregateBy('source'),
      byUser:   aggregateBy('user'),
    }
  }

  return {
    totalLids: leads.length,
    respondedCount: responded.length,
    noResponseCount,
    ...aggStats('responseMinutes'),
    business: aggStats('businessMinutes'),
  }
}

function buildCrmReport(profile, period, monthKey, dateRange, rng) {
  const leads = buildRoster(profile, period, dateRange, rng)

  // ── sources ──────────────────────────────────────────────────────────
  const sources = {}
  const ensureSrc = (k) => (sources[k] = sources[k] || {
    totalLeads: 0, relevantLeads: 0, nonRelevantLeads: 0,
    meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0,
    registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0,
  })

  const totals = {
    totalLeads: 0, relevantLeads: 0, nonRelevantLeads: 0, irrelevantLeads: 0,
    meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0,
    registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0,
  }

  for (const l of leads) {
    const b = ensureSrc(l.source)
    totals.totalLeads++; b.totalLeads++
    if (l.relevant) { totals.relevantLeads++; b.relevantLeads++ }
    else            { totals.nonRelevantLeads++; b.nonRelevantLeads++ }
    if (l.scheduled) { totals.meetingsScheduled++; b.meetingsScheduled++ }
    if (l.completed) { totals.meetingsCompleted++; b.meetingsCompleted++ }
    if (l.cancelled) { totals.meetingsCancelled++; b.meetingsCancelled++ }
    if (l.registration) {
      totals.registrations++; b.registrations++
      totals.registrationValue += l.registrationValue; b.registrationValue += l.registrationValue
    }
    if (l.contract) {
      totals.contracts++; b.contracts++
      totals.contractValue += l.contractValue; b.contractValue += l.contractValue
    }
  }
  totals.irrelevantLeads = totals.nonRelevantLeads

  // ── data[] (xlsxRows) ────────────────────────────────────────────────
  const data = Object.entries(sources).map(([source, s]) => ({
    source,
    totalLeads: s.totalLeads,
    relevantLeads: s.relevantLeads,
    irrelevantLeads: s.nonRelevantLeads,
    meetingsScheduled: s.meetingsScheduled,
    meetingsCompleted: s.meetingsCompleted,
    meetingsCancelled: s.meetingsCancelled,
    registrations: s.registrations,
    registrationValue: s.registrationValue,
    contracts: s.contracts,
    contractValue: s.contractValue,
  })).sort((a, b) => b.totalLeads - a.totalLeads)

  // ── crmRepRows (יישובים + התנגדויות) ─────────────────────────────────
  // `scheduled` אינו קיים ב-crmRepRows של BMBY היום — ראה ההערה ב-README
  // (buildGeoWasteRec מחפש אותו ולכן ההמלצה "עיר ששורפת תקציב" לא נדלקת
  // גם ללקוחות אמיתיים). אנחנו פולטים אותו בדמו; שדה נוסף אינו מזיק לשאר
  // הרכיבים, והוא יתאים אוטומטית כשהשדה יתווסף גם ב-bmby/fetch.
  const crmRepRows = leads.map(l => ({
    address: l.city,
    objections: l.objection,
    lastMeeting: l.meetingDate ? ymd(l.meetingDate) : '',
    hasContract: l.contract,
    scheduled: l.scheduled,
  }))

  // ── התפלגות ימים ושעות ───────────────────────────────────────────────
  const DOW_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
  const dayOfWeekStats = {}
  DOW_NAMES.forEach((name, i) => { dayOfWeekStats[i] = { name, leads: 0, scheduled: 0 } })
  // ⚠️ **מערכים**, לא אובייקטים. app/admin/page.js מסנן ב-Array.isArray
  // ומדלג בשקט על אובייקט — מה שהותיר את הסדרות "לידים" ו"פגישות שתואמו"
  // ריקות לגמרי בגרף השעות, בלי שום שגיאה. bmby/fetch פולט Array.from(24).
  const hourlyLeadStats = Array.from({ length: 24 }, () => 0)
  const hourlyApptStats = Array.from({ length: 24 }, () => 0)

  // v14: שעת יצירת הקשר הראשונה, וכמה מתוכן הבשילו לפגישה.
  // הצורה חייבת להיות **מערך** באורך 24 — admin/page.js בודק Array.isArray
  // ומדלג בשקט על אובייקט, מה שהיה מותיר את הקו "% הבשלה לפגישה" ריק.
  const hourlyContactStats   = Array.from({ length: 24 }, () => 0)
  const hourlyContactMeeting = Array.from({ length: 24 }, () => 0)

  for (const l of leads) {
    dayOfWeekStats[l.dow].leads++
    if (l.scheduled) dayOfWeekStats[l.dow].scheduled++
    hourlyLeadStats[l.hour]++
    if (l.scheduled && l.apptHour != null) hourlyApptStats[l.apptHour]++
    // שעת המענה = שעת הליד + זמן התגובה (בדיוק כמו ש-bmby/fetch קורא את
    // create_date של המשימה הראשונה)
    if (l.responded) {
      // שעת המענה הגולמית = שעת הליד + זמן התגובה. אבל אנשי מכירות לא
      // מחייגים ב-02:00 — ליד שנכנס ב-22:00 עם תגובה של 4 שעות נענה למחרת
      // בבוקר. בלי הגלגול הזה הגרף החדש (v14) מראה יצירות קשר בלילה ו-100%
      // הבשלה על מדגם של ליד אחד.
      const raw = (l.hour + Math.floor(l.responseMinutes / 60)) % 24
      const contactHour = (raw >= 8 && raw <= 20) ? raw : 9
      hourlyContactStats[contactHour]++
      if (l.scheduled) hourlyContactMeeting[contactHour]++
    }
  }

  // ── namedLeads ───────────────────────────────────────────────────────
  const namedLeads = {
    all:      buildNamedLeadsGroup(leads),
    facebook: buildNamedLeadsGroup(leads.filter(l => isFbSource(l.source))),
    google:   buildNamedLeadsGroup(leads.filter(l => isGlSource(l.source))),
  }

  // ── completedMeetings ────────────────────────────────────────────────
  const completedMeetings = leads
    .filter(l => l.completed)
    .map(l => ({
      name: l.name,
      phone: l.phone,
      date: `${ymd(l.meetingDate)} ${pad(l.meetingDate.getHours())}:${pad(l.meetingDate.getMinutes())}:00`,
      description: l.meetingNote,
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))

  return {
    source: 'crm',
    month: monthKey,
    data,
    summary: {
      ...totals,
      sources,
      crmRepRows,
      responseTimeStats: buildResponseTimeStats(leads),
      dayOfWeekStats,
      hourlyApptStats,
      hourlyLeadStats,
      hourlyContactStats,
      hourlyContactMeeting,
      namedLeads,
      completedMeetings,
      schemaVersion: CRM_SCHEMA_VERSION,
    },
    file_name: 'Demo dataset (frozen)',
    row_count: data.length,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// דוחות פרסום (Meta / Google)
// ═══════════════════════════════════════════════════════════════════════════

function adMetrics(share, p) {
  return {
    spend:       Math.round(p.spend * share * 100) / 100,
    impressions: Math.round(p.impressions * share),
    reach:       Math.round(p.reach * share),
    clicks:      Math.round(p.clicks * share),
    leads:       0, // ממולא בהמשך בהקצאה שלמה
  }
}

function computeTotals(rows) {
  const t = { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 }
  for (const r of rows) {
    t.spend += r.spend; t.impressions += r.impressions
    t.reach += r.reach; t.clicks += r.clicks; t.leads += r.leads
  }
  t.spend      = Math.round(t.spend * 100) / 100
  t.cpl        = t.leads > 0 ? t.spend / t.leads : 0
  t.cpc        = t.clicks > 0 ? t.spend / t.clicks : 0
  t.cpm        = t.impressions > 0 ? (t.spend / t.impressions) * 1000 : 0
  t.ctr        = t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0
  t.convRate   = t.clicks > 0 ? (t.leads / t.clicks) * 100 : 0
  t.frequency  = t.reach > 0 ? t.impressions / t.reach : 0
  return t
}

function buildFacebookReport(profile, period, monthKey, rng) {
  const p = period.facebook
  const campaigns = FB_CAMPAIGNS(DEMO.projectName)

  // מבנה: קמפיין → 2 אדסטים → 2 מודעות → פירוק גיל×מגדר
  const units = []
  campaigns.forEach((camp, ci) => {
    const adsets = [FB_ADSETS[ci * 2 % FB_ADSETS.length], FB_ADSETS[(ci * 2 + 1) % FB_ADSETS.length]]
    adsets.forEach((adSet, si) => {
      for (let ai = 0; ai < 2; ai++) {
        const k = (ci * 4 + si * 2 + ai)
        // שם מודעה ייחודי לכל יחידה — buildCreativeRec מקבץ לפי adName,
        // ושמות חוזרים היו ממזגים מודעות שונות לשורה אחת ומוחקים את פיזור ה-CPL.
        const variant = Math.floor(k / FB_ADS.length) + 1
        const adName  = variant > 1
          ? `${FB_ADS[k % FB_ADS.length]} · גרסה ${variant}`
          : FB_ADS[k % FB_ADS.length]
        units.push({
          campaign: camp,
          adSet,
          adName,
          adText: FB_AD_TEXTS[k % FB_AD_TEXTS.length],
          creative: DEMO_CREATIVES[k % DEMO_CREATIVES.length],
          campaignStatus: ci === 3 ? 'PAUSED' : 'ACTIVE',
          adSetStatus:    ci === 3 ? 'PAUSED' : 'ACTIVE',
          // המודעה הכי יעילה והכי בזבזנית חייבות להישאר ACTIVE — הדשבורד
          // מסנן את ההמלצה לפי summary.activeAds בלבד.
          adStatus:       (k === 5 || k === 11) ? 'PAUSED' : 'ACTIVE',
          weight: (profile.fbCampaignWeights[ci] / 4) * (0.7 + rng() * 0.6),
          efficiency: (profile.adEfficiency || [])[k] ?? 1,
        })
      }
    })
  })

  const unitWeights = units.map(u => u.weight)
  // ההוצאה מתחלקת לפי weight; הלידים לפי weight×efficiency — וכך נוצר
  // פיזור CPL אמיתי בין המודעות (במקום CPL זהה לכולן).
  const unitLeads   = allocate(p.leads, units.map(u => u.weight * u.efficiency))
  const unitShare   = allocateFloat(1, unitWeights)

  const rows = []
  units.forEach((u, ui) => {
    // פירוק גיל × מגדר
    const cells = []
    profile.ageBuckets.forEach((age, ai) => {
      profile.genderBuckets.forEach((gender, gi) => {
        cells.push({ age, gender, w: profile.ageWeights[ai] * profile.genderWeights[gi] })
      })
    })
    const cellWeights = cells.map(c => c.w)
    const cellLeads   = allocate(unitLeads[ui], cellWeights)
    const cellShares  = allocateFloat(unitShare[ui], cellWeights)

    cells.forEach((cell, ci) => {
      const m = adMetrics(cellShares[ci], p)
      rows.push({
        campaign: u.campaign,
        adSet: u.adSet,
        adName: u.adName,
        adText: u.adText,
        gender: cell.gender,
        age: cell.age,
        spend: m.spend,
        impressions: m.impressions,
        reach: m.reach,
        clicks: m.clicks,
        leads: cellLeads[ci],
        campaignStatus: u.campaignStatus,
        adSetStatus: u.adSetStatus,
        adStatus: u.adStatus,
      })
    })
  })

  // ── activeAds ────────────────────────────────────────────────────────
  // המבנה חייב להיות זהה למה ש-app/api/meta/fetch מייצר, אחרת המקטע
  // "המודעות הכי מובילות ב-Facebook" מציג 0 לידים ו-₪0 לכל מודעה:
  //   · השדה הוא `name` (לא `adName`)
  //   · חייב `metrics: {spend, impressions, clicks, leads}` — הכרטיסים
  //     והמיון של Top-5 קוראים ממנו
  //   · `summary.activeAdNames` משמש כגיבוי בבניית מפת המודעות הפעילות
  const metricsByUnit = units.map(() => ({ spend: 0, impressions: 0, clicks: 0, leads: 0 }))
  rows.forEach((r) => {
    const ui = units.findIndex(u => u.adName === r.adName && u.campaign === r.campaign && u.adSet === r.adSet)
    if (ui < 0) return
    const m = metricsByUnit[ui]
    m.spend += r.spend; m.impressions += r.impressions
    m.clicks += r.clicks; m.leads += r.leads
  })

  const activeAds = units
    .map((u, i) => ({ u, i }))
    .filter(({ u }) => u.adStatus === 'ACTIVE')
    .map(({ u, i }) => ({
      id: `demo-ad-${i + 1}`,
      name: u.adName,
      campaign: u.campaign,
      adSet: u.adSet,
      status: 'ACTIVE',
      body: u.adText,
      title: `${DEMO.projectName} — ${u.adName.split('|')[0].split('·')[0].trim()}`,
      imageUrl: u.creative,
      thumbnailUrl: u.creative,
      videoId: '',
      videoUrl: '',
      postId: '',
      imageHash: '',
      metrics: {
        spend: Math.round(metricsByUnit[i].spend * 100) / 100,
        impressions: metricsByUnit[i].impressions,
        clicks: metricsByUnit[i].clicks,
        leads: metricsByUnit[i].leads,
      },
    }))
    .sort((a, b) => b.metrics.leads - a.metrics.leads)

  return {
    source: 'facebook',
    month: monthKey,
    data: rows,
    summary: {
      ...computeTotals(rows),
      activeAds,
      activeAdNames: activeAds.map(a => a.name),
    },
    file_name: 'Demo dataset (frozen)',
    row_count: rows.length,
  }
}

function buildGoogleReport(profile, period, monthKey, rng) {
  const p = period.google
  const campaigns = GOOGLE_CAMPAIGNS(DEMO.projectName)

  const units = []
  campaigns.forEach((camp, ci) => {
    const isPmax = /PMax/i.test(camp)
    const groups = isPmax
      ? ['PERFORMANCE_MAX']
      : [GOOGLE_ADGROUPS[ci % GOOGLE_ADGROUPS.length], GOOGLE_ADGROUPS[(ci + 2) % GOOGLE_ADGROUPS.length]]
    groups.forEach((adSet, gi) => {
      units.push({
        campaign: camp,
        campaignStatus: ci === 3 ? 'PAUSED' : 'ENABLED',
        adSet,
        adSetStatus: isPmax ? '' : 'ENABLED',
        adName: isPmax ? camp : `${adSet} | RSA ${gi + 1}`,
        adStatus: isPmax ? '' : 'ENABLED',
        adText: isPmax ? '' : GOOGLE_AD_TEXTS[(ci + gi) % GOOGLE_AD_TEXTS.length],
        weight: (profile.googleCampaignWeights[ci] / groups.length) * (0.75 + rng() * 0.5),
      })
    })
  })

  const weights = units.map(u => u.weight)
  const leadsAlloc = allocate(p.leads, weights)
  const shares = allocateFloat(1, weights)

  const rows = units.map((u, i) => {
    const m = adMetrics(shares[i], p)
    return {
      campaign: u.campaign,
      campaignStatus: u.campaignStatus,
      adSet: u.adSet,
      adSetStatus: u.adSetStatus,
      adName: u.adName,
      adStatus: u.adStatus,
      adText: u.adText,
      gender: '',
      age: '',
      spend: m.spend,
      impressions: m.impressions,
      reach: 0,
      clicks: m.clicks,
      leads: leadsAlloc[i],
    }
  })

  const pmaxCampaign = campaigns.find(c => /PMax/i.test(c))
  const assetGroups = ASSET_GROUP_NAMES.map((name, i) => ({
    id: `demo-ag-${i + 1}`,
    name,
    campaign: pmaxCampaign,
    assets: [
      { type: 'HEADLINE',    text: `${DEMO.projectName} — דירות 3-5 חדרים`, imageUrl: '', youtubeId: '', name: '' },
      { type: 'DESCRIPTION', text: GOOGLE_AD_TEXTS[i % GOOGLE_AD_TEXTS.length], imageUrl: '', youtubeId: '', name: '' },
      { type: 'MARKETING_IMAGE', text: '', imageUrl: DEMO_CREATIVES[i % DEMO_CREATIVES.length], youtubeId: '', name: '' },
    ],
  }))

  return {
    source: 'google',
    month: monthKey,
    data: rows,
    summary: { ...computeTotals(rows), assetGroups, schemaVersion: GOOGLE_SCHEMA_VERSION },
    file_name: 'Demo dataset (frozen)',
    row_count: rows.length,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// חישוב טווחי תאריכים לתקופות
// ═══════════════════════════════════════════════════════════════════════════

/**
 * מחזיר { key, start, end } לכל אחת משלוש התקופות, יחסית לחודש בסיס נתון.
 * זהו בדיוק אותו חישוב שעושה presetToPayload ב-app/admin/page.js — ולכן
 * המפתחות שנייצר יתאימו למה שהדשבורד מחפש.
 */
export function periodKeys(baseYear, baseMonth1, spanDaysCurrent) {
  const cy = baseYear, cm = baseMonth1                     // חודש נוכחי (1-12)
  const py = cm === 1 ? cy - 1 : cy
  const pm = cm === 1 ? 12 : cm - 1                        // חודש קודם

  const lastDay = (y, m) => new Date(y, m, 0).getDate()

  return {
    current: {
      key: `${cy}-${pad(cm)}`,
      start: new Date(cy, cm - 1, 1),
      end: new Date(cy, cm - 1, Math.min(spanDaysCurrent, lastDay(cy, cm))),
    },
    previous: {
      key: `${py}-${pad(pm)}`,
      start: new Date(py, pm - 1, 1),
      end: new Date(py, pm - 1, lastDay(py, pm)),
    },
    q2: {
      key: `${cy}-04-01_${cy}-06-30`,
      start: new Date(cy, 3, 1),
      end: new Date(cy, 5, 30),
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// נקודת הכניסה
// ═══════════════════════════════════════════════════════════════════════════

/**
 * מייצר את הדאטהסט המלא: 3 תקופות × 3 מקורות = 9 רשומות reports.
 * @param {object} profile  הפרופיל המספרי (scripts/demo/profile.mjs)
 * @param {object} [opts]   { baseYear, baseMonth1 } — לעקיפת חודש הבסיס
 */
export function synthesize(profile, opts = {}) {
  const [by, bm] = profile.baseMonth.split('-').map(Number)
  const baseYear   = opts.baseYear   ?? by
  const baseMonth1 = opts.baseMonth1 ?? bm

  const ranges = periodKeys(baseYear, baseMonth1, profile.periods.current.spanDays)
  const reports = []

  for (const name of ['current', 'previous', 'q2']) {
    const period = profile.periods[name]
    const range  = ranges[name]
    // PRNG נפרד לכל תקופה + מקור → שינוי בתקופה אחת לא מזיז את השאר
    reports.push(buildCrmReport(profile, period, range.key, range, makeRng(profile.seed + name.length * 7919)))
    reports.push(buildFacebookReport(profile, period, range.key, makeRng(profile.seed + name.length * 104729)))
    reports.push(buildGoogleReport(profile, period, range.key, makeRng(profile.seed + name.length * 1299709)))
  }

  return {
    meta: {
      client: DEMO.clientName,
      project: DEMO.projectName,
      color: DEMO.clientColor,
      baseMonth: `${baseYear}-${pad(baseMonth1)}`,
      // מספר הימים שהחודש הנוכחי מכסה בדאטהסט — ה-seeder צריך אותו כדי
      // למפות את התאריכים לטווח [1 בחודש .. היום] ולא לייצר תאריכים עתידיים.
      currentSpanDays: profile.periods.current.spanDays,
      monthlyBudget: profile.monthlyBudget,
      crmSchemaVersion: CRM_SCHEMA_VERSION,
      periodKeys: {
        current: ranges.current.key,
        previous: ranges.previous.key,
        q2: ranges.q2.key,
      },
    },
    reports,
  }
}

export default synthesize
