/**
 * lib/report-pdf.js — דוח תקופתי להדפסה / שמירה כ-PDF (D19, ויטלי 1.10 ו-4.10).
 *
 * הכפתור "ייצוא דוח" בראש הדשבורד (אדמין בלבד) מפיק דוח על התקופה שפתוחה במסך, מול
 * תקופת ההשוואה של הדשבורד (comparisonPeriodKey — חודש מול חודש קודם, חודש רץ מול אותם
 * ימים בחודש הקודם, טווח מול הטווח שלפניו). הסדר (ויטלי, 25.10): כרטיסי מדדים, משפך, קמפיינים,
 * מקורות הגעה, זמני טיפול, התנגדויות ויישובים, מה השתנה, מודעות פייסבוק.
 *
 * למה HTML להדפסה ולא ספריית PDF: עברית ו-RTL עובדים בדפדפן בלי גופן מוטמע, הטקסט ב-PDF
 * נשאר טקסט (אפשר לחפש ולהעתיק), ואין תלות חדשה. החלון נפתח עם דיאלוג ההדפסה, ושם
 * בוחרים "שמירה כ-PDF"; שם הקובץ המוצע הוא כותרת הדף.
 *
 * הקובץ טהור (בלי React ובלי רשת): buildReportModel מחשב, renderReportHtml מרכיב.
 * הנתונים מגיעים מאותן שורות reports שהדשבורד מציג — אין כאן חישוב חדש של CRM.
 */
import { aggregateRows, formatMonth } from './helpers.js'
import { normalizeObjections } from './objection-normalize.js'

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const isGoogle = (s) => typeof s === 'string' && s.startsWith('google')

/** תווית קריאה לתקופה: "ספטמבר 2026" או "01.09-15.09.2026" (מקף רגיל — ויטלי, 25.10). */
export function periodLabel(key) {
  if (!key) return ''
  if (!key.includes('_')) return formatMonth(key)
  const [a, b] = key.split('_')
  const d = (s) => s.split('-').reverse().join('.')            // YYYY-MM-DD → DD.MM.YYYY
  const short = (s) => s.split('-').reverse().slice(0, 2).join('.')
  return a.slice(0, 4) === b.slice(0, 4) ? `${short(a)}-${d(b)}` : `${d(a)}-${d(b)}`
}

/**
 * החודש שרץ מוצג כטווח הימים שלו ("01.10-25.10.2026"), כי מולו משווים לאותם ימים בחודש הקודם
 * (comparisonPeriodKey) — "אוקטובר 2026 מול 01.09-25.09" נראה כמו השוואה של חודש לחלק מחודש.
 */
export function runningMonthLabel(key, now = new Date()) {
  if (!key || key.includes('_')) return ''
  const [y, m] = key.split('-').map(Number)
  const il = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(now)   // YYYY-MM-DD
  const [ty, tm, td] = il.split('-').map(Number)
  if (y !== ty || m !== tm) return ''
  const p2 = (x) => String(x).padStart(2, '0')
  return `01.${p2(m)}-${p2(td)}.${p2(m)}.${y}`
}

/** סכומי מודעות לערוץ: מהסיכום של כל דוח (כמו adTotalsFromSummaries בדשבורד). */
function adTotals(rows) {
  const t = { spend: 0, impressions: 0, clicks: 0, leads: 0 }
  for (const r of rows) {
    const s = r.summary || {}
    let src = s
    // שורה בלי סיכום (נדיר) — מהנתונים עצמם.
    if (s.spend == null && Array.isArray(r.data)) src = aggregateRows(r.data).totals
    t.spend += n(src.spend); t.impressions += n(src.impressions); t.clicks += n(src.clicks); t.leads += n(src.leads)
  }
  t.cpl = t.leads > 0 ? t.spend / t.leads : null
  return t
}

/** השורות של תקופה אחת → { fb, google, ads, crm, crmType, campaigns } */
export function periodFacts(rows) {
  const list = Array.isArray(rows) ? rows : []
  const fbRows = list.filter(r => r.source === 'facebook')
  const gRows = list.filter(r => isGoogle(r.source))
  const crmRow = list.find(r => r.source === 'crm') || null
  const fb = adTotals(fbRows), google = adTotals(gRows)
  const ads = { spend: fb.spend + google.spend, impressions: fb.impressions + google.impressions, clicks: fb.clicks + google.clicks, leads: fb.leads + google.leads }
  ads.cpl = ads.leads > 0 ? ads.spend / ads.leads : null

  // קמפיינים — רק כשהנתונים המפורטים טעונים. בלעדיהם הסעיף מושמט (ולא מוצג ריק).
  const campaigns = []
  for (const [platform, rs] of [['Facebook', fbRows], ['Google', gRows]]) {
    const data = rs.flatMap(r => Array.isArray(r.data) ? r.data : [])
    if (!data.length) continue
    for (const [name, c] of Object.entries(aggregateRows(data).campaigns)) {
      campaigns.push({ name, platform, spend: c.spend, leads: c.leads, cpl: c.leads > 0 ? c.spend / c.leads : null })
    }
  }
  campaigns.sort((a, b) => (b.leads - a.leads) || (b.spend - a.spend))

  const crm = crmRow?.summary || null
  const crmType = crm ? (crm.crmType || 'bmby') : null
  return { fb, google, ads, crm, crmType, campaigns, hasAds: fbRows.length + gRows.length > 0 }
}

// אותו נרמול כמו בגלריה "המודעות הכי מובילות ב-Facebook" (admin/page.js): מודעה שהועתקה
// לכמה קבוצות ("- עותק 2", "#3") היא אותה מודעה.
const normAdName = (s) => String(s || '').replace(/[‎‏​‌‍‪-‮⁦-⁩﻿]/g, '').replace(/\s*[-–]\s*עותק\s*\d*$/, '').replace(/\s*#\d+$/, '').trim()

/**
 * המודעות המובילות בפייסבוק (ויטלי, 25.10: "כמו בדשבורד") — מהמודעות הפעילות שבסיכום
 * (summary.activeAds), מאוחדות לפי שם ומדורגות לפי לידים.
 * המספרים מהנתונים המפורטים של התקופה כשהם טעונים: activeAds של טווח הם תמונת מצב מהדוח
 * השמור (range-rows.js), כך שהמדדים שבהם לא בהכרח של הטווח. בלי נתונים מפורטים — מהמודעה עצמה.
 */
export function topFacebookAds(rows, limit = 6) {
  const fbRows = (Array.isArray(rows) ? rows : []).filter(r => r.source === 'facebook')
  const pool = new Map()
  for (const ad of fbRows.flatMap(r => r.summary?.activeAds || [])) {
    const key = normAdName(ad.name) || ad.id
    if (!key) continue
    const m = ad.metrics || {}
    const o = pool.get(key)
    if (!o) {
      pool.set(key, { name: normAdName(ad.name) || ad.name || '', campaign: ad.campaign || '', image: ad.imageUrl || ad.thumbnailUrl || '',
        isVideo: !!(ad.videoUrl || ad.videoId), spend: n(m.spend), leads: n(m.leads), clicks: n(m.clicks), impressions: n(m.impressions) })
    } else {
      o.spend += n(m.spend); o.leads += n(m.leads); o.clicks += n(m.clicks); o.impressions += n(m.impressions)
      if (!o.image) o.image = ad.imageUrl || ad.thumbnailUrl || ''
      if (ad.videoUrl || ad.videoId) o.isVideo = true
    }
  }
  const data = fbRows.flatMap(r => Array.isArray(r.data) ? r.data : [])
  if (data.length) {
    const byName = new Map()
    for (const d of data) {
      const k = normAdName(d.adName)
      if (!k) continue
      const s = byName.get(k) || byName.set(k, { spend: 0, leads: 0, clicks: 0, impressions: 0 }).get(k)
      s.spend += n(d.spend); s.leads += n(d.leads); s.clicks += n(d.clicks); s.impressions += n(d.impressions)
    }
    for (const [k, o] of pool) Object.assign(o, byName.get(k) || { spend: 0, leads: 0, clicks: 0, impressions: 0 })
  }
  return [...pool.values()]
    .filter(a => a.leads > 0 || a.spend > 0)
    .sort((a, b) => (b.leads - a.leads) || (b.spend - a.spend))
    .slice(0, limit)
    .map(a => ({ ...a, cpl: a.leads > 0 ? a.spend / a.leads : null, ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : null }))
}

/** מדדי ה-CRM לפי סוג המערכת. מחזיר [{key,label,value,isCost?,money?}] */
function crmMetrics(f) {
  const s = f.crm
  if (!s) return []
  const spend = f.ads.spend
  const per = (x) => (x > 0 && spend > 0 ? spend / x : null)
  const d = s.deals || {}
  if (f.crmType === 'zoho') {
    return [
      { key: 'crmLeads', label: 'לידים ב-CRM', value: n(s.totalLeads) },
      { key: 'relevant', label: 'לידים רלוונטיים', value: n(s.relevantLeads) },
      { key: 'opps', label: 'הזדמנויות', value: n(d.opportunities) },
      { key: 'closed', label: 'מכירות', value: n(d.closed) },
      { key: 'revenue', label: 'הכנסות', value: n(d.revenue), money: true },
      { key: 'cps', label: 'עלות למכירה', value: per(n(d.closed)), isCost: true, money: true },
    ]
  }
  if (f.crmType === 'salesforce') {
    return [
      { key: 'crmLeads', label: 'לידים ב-CRM', value: n(s.totalLeads) },
      { key: 'relevant', label: 'לידים רלוונטיים', value: n(s.relevantLeads) },
      { key: 'meetSched', label: 'פגישות שתואמו', value: n(s.meetingsScheduled) },
      { key: 'closed', label: 'מכירות', value: n(d.closed) },
      { key: 'revenue', label: 'הכנסות', value: n(d.revenue), money: true },
      { key: 'cps', label: 'עלות למכירה', value: per(n(d.closed)), isCost: true, money: true },
    ]
  }
  // BMBY ופיירברי — פריסת הנדל"ן. בפיירברי אין הרשמות וחוזים, ולכן הם לא מוצגים.
  const out = [
    { key: 'crmLeads', label: 'לידים ב-CRM', value: n(s.totalLeads) },
    { key: 'relevant', label: 'לידים רלוונטיים', value: n(s.relevantLeads) },
    { key: 'meetSched', label: 'פגישות שתואמו', value: n(s.meetingsScheduled) },
    { key: 'meetDone', label: 'פגישות שבוצעו', value: n(s.meetingsCompleted) },
    { key: 'cpm', label: 'עלות לפגישה שבוצעה', value: per(n(s.meetingsCompleted)), isCost: true, money: true },
  ]
  if (f.crmType !== 'fireberry') {
    out.push({ key: 'regs', label: 'הרשמות', value: n(s.registrations) })
    out.push({ key: 'contracts', label: 'חוזים', value: n(s.contracts) })
  }
  return out
}

function funnelSteps(f) {
  const s = f.crm
  if (!s) return []
  const d = s.deals || {}
  if (f.crmType === 'zoho') return [['לידים', n(s.totalLeads)], ['רלוונטיים', n(s.relevantLeads)], ['הזדמנויות', n(d.opportunities)], ['מכירות', n(d.closed)]]
  if (f.crmType === 'salesforce') return [['לידים', n(s.totalLeads)], ['רלוונטיים', n(s.relevantLeads)], ['פגישות שתואמו', n(s.meetingsScheduled)], ['מכירות', n(d.closed)]]
  const steps = [['לידים', n(s.totalLeads)], ['רלוונטיים', n(s.relevantLeads)], ['פגישות שתואמו', n(s.meetingsScheduled)], ['פגישות שבוצעו', n(s.meetingsCompleted)]]
  if (f.crmType !== 'fireberry') steps.push(['חוזים', n(s.contracts)])
  return steps
}

/** מקורות הגעה מה-CRM: BMBY/פיירברי — sources {שם: {totalLeads, meetingsScheduled}}; זוהו/סיילספורס — bySource {שם: מספר}. */
function crmSources(s) {
  if (!s) return {}
  const out = {}
  const src = s.sources || s.bySource || {}
  for (const [name, v] of Object.entries(src)) {
    if (v && typeof v === 'object') out[name] = { leads: n(v.totalLeads), meetings: v.meetingsScheduled != null ? n(v.meetingsScheduled) : null }
    else out[name] = { leads: n(v), meetings: null }
  }
  return out
}


// ── טיפול בלידים (ויטלי, 5.10: "לא ממש מבינים מה קרה ללידים — כמה טופלו, למה וכמה לא") ──
// הכל מתוך סיכום ה-CRM שכבר שמור; כל CRM שומר את זה בצורה אחרת, וכאן זה מתאחד.
const BUCKETS = [
  ['0-15m', 'עד 15 דק׳'], ['15m-1h', '15 דק׳-שעה'], ['1h-4h', '1-4 שעות'], ['4h-8h', '4-8 שעות'],
  [['8h-1d', '8h-24h'], '8-24 שעות'], ['1d-3d', '1-3 ימים'], ['3d+', 'מעל 3 ימים'],
]
const topEntries = (obj, k = 6) => Object.entries(obj || {})
  .map(([name, v]) => ({ name, count: n(typeof v === 'object' && v ? v.count : v) }))
  .filter(x => x.count > 0 && x.name).sort((a, b) => b.count - a.count).slice(0, k)

export function leadHandling(f) {
  const s = f.crm
  if (!s) return null
  let total = null, responded = null, noResponse = null, median = null, medianLabel = 'זמן מענה חציוני'
  let within1h = null, buckets = null, basis = null, byRep = [], statuses = [], reasons = [], reasonsTitle = 'סיבות'

  if (f.crmType === 'zoho') {
    const rt = s.responseTime || {}
    responded = n(rt.respondedCount); noResponse = n(rt.noResponseCount); total = responded + noResponse
    median = rt.avgHours != null && responded ? n(rt.avgHours) * 60 : null; medianLabel = 'זמן מענה ממוצע'
    within1h = responded ? n(rt.respondedWithin1h) : null
    buckets = rt.buckets || null; basis = 'clock'
    byRep = (rt.byAgent || []).map(a => ({ name: a.name, count: n(a.noResponse), of: n(a.count) })).filter(a => a.count > 0)
    statuses = topEntries(s.byStatus); reasons = topEntries(s.objections); reasonsTitle = 'התנגדויות'
  } else if (f.crmType === 'salesforce') {
    const rt = s.responseTime || {}
    responded = rt.measured != null ? n(rt.measured) : null
    median = rt.medianHours != null && responded ? n(rt.medianHours) * 60 : null
    within1h = responded ? n(rt.within1h) : null; basis = 'clock'
    statuses = topEntries(s.byStatus)
    reasons = (s.unqualReasons || []).map(r => ({ name: r.reason, count: n(r.count) })).filter(r => r.count > 0).slice(0, 6)
    reasonsTitle = 'סיבות לליד לא מתאים'
  } else {
    // BMBY ופיירברי: responseTimeStats, עם גרסה בשעות עבודה (business) שמעדיפים כשיש.
    const rt = s.responseTimeStats || {}
    if (rt.totalLids != null) {
      total = n(rt.totalLids); responded = n(rt.respondedCount); noResponse = n(rt.noResponseCount)
      const biz = rt.business && rt.business.buckets ? rt.business : null
      const st = biz || rt
      basis = biz ? 'business' : 'clock'
      median = responded && st.medianMinutes != null ? n(st.medianMinutes) : null
      buckets = st.buckets || null
      if (buckets && responded) within1h = ((n(buckets['0-15m']) + n(buckets['15m-1h'])) / responded) * 100
      byRep = topEntries(rt.noResponseByUser, 5)
    }
    statuses = topEntries(s.byStatus)
    if (Array.isArray(s.crmRepRows)) {
      const c = {}
      for (const row of s.crmRepRows) for (const o of normalizeObjections(row.objections || '')) c[o] = (c[o] || 0) + 1
      reasons = topEntries(c); reasonsTitle = 'התנגדויות'
    }
  }
  if (total == null && responded == null && !statuses.length && !reasons.length) return null
  const bucketRows = buckets ? BUCKETS.map(([keys, label]) => {
    const count = [].concat(keys).reduce((a, k) => a + n(buckets[k]), 0)
    return { label, count, pct: responded ? (count / responded) * 100 : null }
  }) : []
  return {
    total, responded, noResponse,
    respondedPct: total ? (responded / total) * 100 : null,
    median, medianLabel, within1h, basis, buckets: bucketRows,
    byRep: byRep.sort((a, b) => b.count - a.count).slice(0, 5),
    statuses, reasons, reasonsTitle,
  }
}

export function changePct(cur, prev) {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null
  return ((cur - prev) / prev) * 100
}

/**
 * @param {{project:string, client?:string, key:string, prevKey:string, rows:object[], prevRows:object[], now?:Date}} input
 */
export function buildReportModel({ project, client, key, prevKey, rows, prevRows, now = new Date() }) {
  const cur = periodFacts(rows), prev = periodFacts(prevRows)
  const kpis = []
  if (cur.hasAds || prev.hasAds) {
    kpis.push({ key: 'spend', label: 'הוצאה על פרסום', value: cur.ads.spend, prev: prev.hasAds ? prev.ads.spend : null, money: true })
    kpis.push({ key: 'leads', label: 'לידים מהפרסום', value: cur.ads.leads, prev: prev.hasAds ? prev.ads.leads : null })
    kpis.push({ key: 'cpl', label: 'עלות לליד', value: cur.ads.cpl, prev: prev.hasAds ? prev.ads.cpl : null, isCost: true, money: true })
  }
  const prevCrm = new Map(crmMetrics(prev).map(m => [m.key, m.value]))
  for (const m of crmMetrics(cur)) kpis.push({ ...m, prev: prev.crm ? (prevCrm.get(m.key) ?? null) : null })
  for (const k of kpis) k.change = changePct(k.value, k.prev)

  const channels = [['Facebook', cur.fb, prev.fb], ['Google', cur.google, prev.google]]
    .filter(([, c, p]) => c.spend > 0 || c.leads > 0 || p.spend > 0 || p.leads > 0)
    .map(([name, c, p]) => ({ name, spend: c.spend, leads: c.leads, cpl: c.cpl, prevSpend: p.spend, prevLeads: p.leads, prevCpl: p.cpl }))

  const prevSteps = new Map(funnelSteps(prev).map(([l, v]) => [l, v]))
  const funnel = funnelSteps(cur).map(([label, value], i, arr) => ({
    label, value, prev: prev.crm ? (prevSteps.get(label) ?? null) : null,
    rate: i > 0 && arr[i - 1][1] > 0 ? (value / arr[i - 1][1]) * 100 : null,
  }))

  const ps = crmSources(prev.crm)
  const sources = Object.entries(crmSources(cur.crm))
    .map(([name, v]) => ({ name, leads: v.leads, meetings: v.meetings, prevLeads: ps[name]?.leads ?? (prev.crm ? 0 : null) }))
    .filter(x => x.leads > 0)
    .sort((a, b) => b.leads - a.leads)
  const sourcesTotal = sources.reduce((a, x) => a + x.leads, 0)

  const handling = leadHandling(cur)
  const prevHandling = leadHandling(prev)
  if (handling && prevHandling) {
    handling.prev = { respondedPct: prevHandling.respondedPct, noResponse: prevHandling.noResponse, median: prevHandling.median, within1h: prevHandling.within1h }
  }

  return {
    project, client: client || '', key, prevKey, handling,
    label: runningMonthLabel(key, now) || periodLabel(key), prevLabel: periodLabel(prevKey),
    generatedAt: now, crmType: cur.crmType,
    kpis, channels, funnel, sources: sources.slice(0, 6), sourcesTotal,
    campaigns: cur.campaigns.slice(0, 5),
    topAds: topFacebookAds(rows),
    profile: leadProfile(cur.crm),
    highlight: biggestChange(kpis),
    hasPrev: prev.hasAds || !!prev.crm,
  }
}

/**
 * פרופיל הלידים מתוך שורות הנציגים (crmRepRows, BMBY): יישובים, מצב דיור, סוג נכס — כמו בטאב
 * "יישובים" בדשבורד. סוג נכס הוא בחירה מרובה ("דירת 3 חדרים,דירת 4 חדרים") ונספר בכל אחד.
 */
export function leadProfile(crm) {
  const rows = Array.isArray(crm?.crmRepRows) ? crm.crmRepRows.filter(r => !r.contractOnly) : []
  if (!rows.length) return null
  const cities = {}, living = {}, property = {}
  for (const r of rows) {
    const c = String(r.address || '').trim()
    if (c && c !== 'לא צוין') cities[c] = (cities[c] || 0) + 1
    const l = String(r.livingStatus || '').trim()
    if (l) living[l] = (living[l] || 0) + 1
    for (const t of String(r.propertyType || '').split(',').map(x => x.trim()).filter(Boolean)) property[t] = (property[t] || 0) + 1
  }
  const out = { cities: topEntries(cities, 10), living: topEntries(living, 6), property: topEntries(property, 6) }
  return out.cities.length || out.living.length || out.property.length ? out : null
}

/**
 * "מה השתנה": המדד עם השינוי היחסי הגדול ביותר, על בסיס שאינו זניח (לפחות 5 בתקופה
 * הקודמת במדדי ספירה) — אחרת 1 → 3 פגישות הוא "+200%" ומסתיר את מה שבאמת זז.
 */
export function biggestChange(kpis) {
  const cands = kpis.filter(k => k.change != null && (k.money || n(k.prev) >= 5))
  if (!cands.length) return null
  // בתיקו — המדד העמוק יותר במשפך (מאוחר ברשימה): פגישות אומרות יותר מלידים.
  const k = cands.reduce((a, b) => (Math.abs(b.change) >= Math.abs(a.change) ? b : a))
  const up = k.change > 0
  const good = k.isCost ? !up : up
  return { label: k.label, change: k.change, value: k.value, prev: k.prev, money: !!k.money, good, up }
}

// ── HTML ────────────────────────────────────────────────────────────────────
// עיצוב: כמו הדשבורד עצמו (ויטלי, 25.10: "העיצוב של הדשבורד לדעתי יותר טוב") — כרטיסי מדדים
// צבעוניים בגווני הדשבורד (vitas-visual.css), פאנלים לבנים במסגרת עדינה, Heebo, ופלטת הגרפים
// של הדשבורד (VCS_PALETTE). מקף רגיל בלבד, הלוגו של VITAS בראש כל עמוד A4, בלי שורת הסבר בתחתית.
// הגרפים הם SVG ו-HTML פשוטים (בלי Chart.js): מודפסים חדים ולא תלויים בסקריפט.
// הסדר (ויטלי, 25.10): מדדים → משפך → קמפיינים → מקורות הגעה → זמני טיפול → התנגדויות, יישובים,
// מצב דיור וסוג נכס → מה השתנה מהחודש הקודם → מודעות פייסבוק.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const DASH = '-'
const fmtNum = (v) => (v == null ? DASH : Math.round(v).toLocaleString('he-IL'))
const fmtMoney = (v) => (v == null ? DASH : '₪' + Math.round(v).toLocaleString('he-IL'))
const fmtVal = (v, money) => (money ? fmtMoney(v) : fmtNum(v))
const fmtPct = (v) => (v == null ? '' : (v > 0 ? '+' : '') + Math.round(v) + '%')
const pctTxt = (v) => (v == null ? DASH : Math.round(v) + '%')

// הפלטה של הגרפים בדשבורד (VCS_PALETTE ב-admin/page.js) והגוונים של כרטיסי המדדים (vr-tone-*).
const PALETTE = ['#4559df', '#299be4', '#119e8c', '#e6a72f', '#9257d1', '#cb567c', '#586581']
const TONES = {
  indigo: ['#5863c9', '#343aa1'], sky: ['#227fbc', '#1563a2'], violet: ['#8b52c3', '#6836a2'],
  emerald: ['#168976', '#066c60'], terra: ['#b75723', '#944016'], rose: ['#bc4766', '#99344f'], navy: ['#2b3a6b', '#16213e'],
}
const AD_TONES = { spend: 'indigo', leads: 'sky', cpl: 'violet' }
const CRM_TONES = ['emerald', 'sky', 'violet', 'terra', 'indigo', 'rose', 'navy']
const toneStyle = (t) => { const [a, b] = TONES[t] || TONES.indigo; return `background: linear-gradient(135deg, ${a}, ${b})` }

/** שינוי באחוזים כתג צבעוני: ירוק = לטובה, אדום = לרעה (בעלויות — ירידה היא לטובה). */
function changeCell(change, isCost) {
  if (change == null) return '<span class="chg">-</span>'
  const flat = Math.abs(change) < 0.5
  const good = isCost ? change <= 0 : change >= 0
  return `<span class="chg ${flat ? 'flat' : good ? 'good' : 'bad'}" dir="ltr">${esc(flat ? '0%' : (change > 0 ? '▲ ' : '▼ ') + fmtPct(change))}</span>`
}

/** מספר עמודות לכרטיסים שממלא שורות שלמות: 10 → 5, 9 → 3, 8 → 4 (ולא שורה אחרונה חצי ריקה). */
export function kpiColumns(count) {
  if (count <= 4) return Math.max(1, count)
  return [4, 5, 3].reduce((best, c) => ((c - count % c) % c < (best - count % best) % best ? c : best))
}

const fmtDuration = (min) => {
  if (min == null) return DASH
  if (min < 60) return Math.round(min) + ' דק׳'
  if (min < 48 * 60) return (Math.round(min / 6) / 10).toLocaleString('he-IL') + ' שעות'
  return (Math.round(min / 144) / 10).toLocaleString('he-IL') + ' ימים'
}
// שינוי בנקודות אחוז (לאחוזים) — "מ-60% ל-70%" הוא +10 נק׳, לא +17%.
function ppCell(cur, prev, lowerIsBetter) {
  if (cur == null || prev == null) return ''
  const d = cur - prev
  if (Math.abs(d) < 0.5) return '<span class="chg flat">ללא שינוי</span>'
  const good = lowerIsBetter ? d < 0 : d > 0
  return `<span class="chg ${good ? 'good' : 'bad'}"><span dir="ltr">${d > 0 ? '+' : ''}${Math.round(d)}</span> נק׳</span>`
}

const bar = (v, max, color = PALETTE[0]) => `<span class="track"><span class="fill" style="width:${max > 0 ? Math.max(2, Math.round((n(v) / max) * 100)) : 0}%;background:${color}"></span></span>`

/** רשימת פסים אופקית (כמו "Top 10 יישובים" בדשבורד): שם, פס, מספר, אחוז. */
function barList(rows, { color, total, extra } = {}) {
  if (!rows.length) return ''
  const max = Math.max(1, ...rows.map(r => r.count || 0))
  return `<table class="barlist"><tbody>${rows.map((r, i) => `<tr><td class="name">${esc(r.name)}</td><td class="bt">${bar(r.count, max, color || PALETTE[i % PALETTE.length])}</td><td class="num strong">${fmtNum(r.count)}${extra ? extra(r) : ''}</td>${total ? `<td class="num muted">${pctTxt((r.count / total) * 100)}</td>` : ''}</tr>`).join('')}</tbody></table>`
}

/** דונאט SVG עם מקרא — כמו הדונאטים של מצב דיור / סוג נכס בדשבורד. */
function donut(rows, { center, centerLabel, total, legend: withLegend = true } = {}) {
  const sum = rows.reduce((a, r) => a + n(r.count), 0)
  if (!sum) return ''
  const R = 50, C = 2 * Math.PI * R
  let off = 0
  const segs = rows.map((r, i) => {
    const len = (n(r.count) / sum) * C
    const seg = `<circle r="${R}" cx="64" cy="64" fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="22" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 64 64)"/>`
    off += len
    return seg
  }).join('')
  const base = total || sum
  const legend = rows.map((r, i) => `<tr><td><i class="dot" style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(r.name)}</td><td class="num strong">${fmtNum(r.count)}</td><td class="num muted">${pctTxt((n(r.count) / base) * 100)}</td></tr>`).join('')
  const svg = `<svg viewBox="0 0 128 128" width="128" height="128" aria-hidden="true">${segs}<text x="64" y="62" text-anchor="middle" class="dn-v">${esc(center ?? fmtNum(sum))}</text><text x="64" y="80" text-anchor="middle" class="dn-l">${esc(centerLabel || '')}</text></svg>`
  return withLegend ? `<div class="donut">${svg}<table class="legend"><tbody>${legend}</tbody></table></div>` : svg
}

let _secN = 0
const secHead = (title, note) => `
      <div class="sec-head"><span class="sec-n">${++_secN}</span><div><h2>${esc(title)}</h2>${note ? `<p class="note">${esc(note)}</p>` : ''}</div></div>`

/** כרטיס מדד צבעוני (vr-metric בדשבורד): תווית, ערך, שינוי ו"לפני". */
const metricCard = (tone, label, value, chg, was, hint) => `
        <div class="metric" style="${toneStyle(tone)}"><div class="m-l">${esc(label)}</div><div class="m-v">${value}</div>${hint ? `<div class="m-h">${esc(hint)}</div>` : ''}${chg || was ? `<div class="m-c">${chg || ''}${was ? `<span>${was}</span>` : ''}</div>` : ''}</div>`
// שינוי על כרטיס צבעוני: תג לבן עם חץ, ירוק/אדום לפי טובה/רעה.
function chip(change, isCost) {
  if (change == null) return ''
  const flat = Math.abs(change) < 0.5
  const good = isCost ? change <= 0 : change >= 0
  return `<span class="mchip ${flat ? 'flat' : good ? 'good' : 'bad'}" dir="ltr">${flat ? '0%' : (change > 0 ? '▲ ' : '▼ ') + esc(fmtPct(change))}</span>`
}

/** כרטיס לבן עם פס צבע (כרטיסי "טיפול בלידים"). */
const statCard = (color, label, valueHtml, chgHtml, was, hint) => `
        <div class="stat" style="border-top-color:${color}"><div class="kl">${esc(label)}</div><div class="kv">${valueHtml}</div>${hint ? `<div class="kh">${esc(hint)}</div>` : ''}<div class="kp">${chgHtml || ''}${was ? ` <span class="was">${was}</span>` : ''}</div></div>`

// צבעי זמני המענה: מהיר = ירוק, איטי = אדום.
const SPEED = ['#119e8c', '#2fb39a', '#299be4', '#4559df', '#9257d1', '#e6a72f', '#cb567c']

function handlingHtml(h) {
  if (!h || (h.total == null && h.responded == null && !h.statuses.length && !h.byRep.length)) return ''
  const p = h.prev || null
  const was = (v) => (p ? 'לפני: ' + v : '')
  const cards = []
  if (h.total != null) cards.push(statCard(PALETTE[2], 'קיבלו מענה', `${fmtNum(h.responded)} <small>מתוך ${fmtNum(h.total)} (${pctTxt(h.respondedPct)})</small>`, p ? ppCell(h.respondedPct, p.respondedPct) : '', was(pctTxt(p?.respondedPct))))
  if (h.noResponse != null) cards.push(statCard(PALETTE[5], 'לא קיבלו מענה', `${fmtNum(h.noResponse)} <small>(${pctTxt(h.total ? 100 - h.respondedPct : null)})</small>`, p ? changeCell(changePct(h.noResponse, p.noResponse), true) : '', was(fmtNum(p?.noResponse))))
  if (h.median != null) {
    // "חציוני" לא אומר כלום ללקוח (ויטלי, 25.10): זה הזמן שחצי מהלידים נענו מהר ממנו.
    const isMedian = !/ממוצע/.test(h.medianLabel)
    const label = (isMedian ? 'זמן מענה טיפוסי' : 'זמן מענה ממוצע') + (h.basis === 'business' ? ' (שעות עבודה)' : '')
    cards.push(statCard(PALETTE[0], label, fmtDuration(h.median), p ? changeCell(changePct(h.median, p.median), true) : '', was(fmtDuration(p?.median)), isMedian ? 'חצי מהלידים נענו מהר יותר מזה' : ''))
  }
  if (h.within1h != null) cards.push(statCard(PALETTE[1], 'מענה תוך שעה', pctTxt(h.within1h), p ? ppCell(h.within1h, p.within1h) : '', was(pctTxt(p?.within1h))))
  const cardsHtml = cards.length ? `<div class="stats" style="grid-template-columns: repeat(${cards.length}, 1fr)">${cards.join('')}</div>` : ''

  // גרף עמודות: כמה לידים נענו בכל טווח זמן
  const maxB = Math.max(1, ...h.buckets.map(b => b.count))
  const bucketsHtml = h.buckets.length && h.responded ? `
      <div class="panel"><h3>כמה זמן לקח לענות${h.basis === 'business' ? ' (בשעות עבודה)' : ''}</h3>
        <div class="columns">${h.buckets.map((b, i) => `
          <div class="col-b"><div class="cb-v">${fmtNum(b.count)}</div><div class="cb-bar"><span style="height:${Math.max(b.count ? 3 : 0, Math.round((b.count / maxB) * 100))}%;background:${SPEED[i % SPEED.length]}"></span></div><div class="cb-l">${esc(b.label)}</div><div class="cb-p">${pctTxt(b.pct)}</div></div>`).join('')}
        </div></div>` : ''

  const cols = [
    h.byRep.length ? `<div class="panel"><h3>לא קיבלו מענה - לפי נציג</h3>${barList(h.byRep, { color: PALETTE[5], extra: r => (r.of ? ` <span class="muted">מתוך ${fmtNum(r.of)}</span>` : '') })}</div>` : '',
    h.statuses.length ? `<div class="panel"><h3>סטטוס הלידים ב-CRM</h3>${barList(h.statuses)}</div>` : '',
  ].filter(Boolean)

  return `
    <section>${secHead('זמני טיפול בלידים', 'מה קרה עם הלידים אחרי שנכנסו: כמה קיבלו מענה, וכמה מהר.')}
      ${cardsHtml}
      ${bucketsHtml}
      ${cols.length ? `<div class="grid2">${cols.join('')}</div>` : ''}
    </section>`
}

/** התנגדויות, יישובים, מצב דיור וסוג נכס — כמו הטאבים "התנגדויות" ו"יישובים" בדשבורד. */
function profileHtml(h, pr) {
  const reasons = h?.reasons || []
  const panels = [
    reasons.length ? `<div class="panel"><h3>${esc(h.reasonsTitle)}</h3>${barList(reasons, { color: PALETTE[5] })}</div>` : '',
    pr?.cities?.length ? `<div class="panel"><h3>יישובים מובילים</h3>${barList(pr.cities, { color: PALETTE[0] })}</div>` : '',
    pr?.living?.length ? `<div class="panel"><h3>מצב דיור</h3>${donut(pr.living, { centerLabel: 'לידים' })}</div>` : '',
    pr?.property?.length ? `<div class="panel"><h3>סוג נכס</h3>${donut(pr.property, { centerLabel: 'בחירות' })}</div>` : '',
  ].filter(Boolean)
  if (!panels.length) return ''
  const title = [reasons.length && (h.reasonsTitle === 'התנגדויות' ? 'התנגדויות' : 'סיבות'), pr?.cities?.length && 'יישובים', pr?.living?.length && 'מצב דיור', pr?.property?.length && 'סוג נכס'].filter(Boolean)
  const t = title.length > 1 ? title.slice(0, -1).join(', ') + ' ו' + title[title.length - 1] : title[0]
  return `
    <section>${secHead(t, 'מי הלידים ומה עוצר אותם, לפי מה שנרשם ב-CRM.')}
      <div class="grid2">${panels.join('')}</div>
    </section>`
}

/**
 * @param {object} m  המודל מ-buildReportModel
 * @param {{assetBase?: string}} [opts]  assetBase: מקור האתר ללוגו (החלון נפתח ריק ונכתב מבחוץ)
 */
export function renderReportHtml(m, { assetBase = '' } = {}) {
  _secN = 0
  const date = m.generatedAt.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const title = `VITAS - ${m.client ? m.client + ' - ' : ''}${m.project} - ${m.label}`
  const logo = `${esc(assetBase)}/brand/vitas/vitas-logo-dark.png`
  const wasTxt = (k) => (m.hasPrev ? 'לפני: ' + esc(fmtVal(k.prev, k.money)) : '')

  // 5) כרטיסים צבעוניים: פרסום ומכירות
  const adKeys = new Set(['spend', 'leads', 'cpl'])
  const adK = m.kpis.filter(k => adKeys.has(k.key)), crmK = m.kpis.filter(k => !adKeys.has(k.key))
  const group = (name, list, toneOf) => list.length ? `
      <div class="kgroup"><h3 class="gh">${name}</h3>
        <div class="metrics" style="grid-template-columns: repeat(${kpiColumns(list.length)}, 1fr)">${list.map((k, i) => metricCard(toneOf(k, i), k.label, esc(fmtVal(k.value, k.money)), m.hasPrev ? chip(k.change, k.isCost) : '', wasTxt(k))).join('')}</div></div>` : ''
  const kpis = m.kpis.length
    ? group('פרסום', adK, k => AD_TONES[k.key] || 'indigo') + group('מכירות', crmK, (k, i) => CRM_TONES[i % CRM_TONES.length])
    : '<p>אין נתונים לתקופה הזו.</p>'

  // 6) משפך: פס ממורכז לכל שלב (רוחב לפי הערך), והאחוז שעבר מהשלב הקודם ביניהם
  const fMax = Math.max(1, ...m.funnel.map(s => s.value || 0))
  const funnel = () => m.funnel.length ? `
    <section>${secHead('משפך לידים', 'כל שלב ביחס לשלב שלפניו: למשל 72% מהלידים הוגדרו רלוונטיים.')}
      <div class="panel funnel">${m.funnel.map((s, i) => `
        ${s.rate != null ? `<div class="f-rate"><span>↓ ${Math.round(s.rate)}% מהשלב הקודם</span></div>` : ''}
        <div class="f-row"><div class="f-l">${esc(s.label)}</div><div class="f-c"><div class="f-bar" style="width:${Math.max(12, Math.round((n(s.value) / fMax) * 100))}%;background:${PALETTE[i % PALETTE.length]}">${fmtNum(s.value)}</div></div><div class="f-p">${m.hasPrev ? `${changeCell(changePct(s.value, s.prev))}<span class="was">לפני: ${fmtNum(s.prev)}</span>` : ''}</div></div>`).join('')}
      </div>
    </section>` : ''

  // 7) קמפיינים מובילים, ומעליהם הפיצול בין הערוצים
  const cMax = Math.max(1, ...m.campaigns.map(c => c.leads || 0))
  const chColor = (name) => (name === 'Google' ? PALETTE[1] : PALETTE[0])
  const channelsHtml = m.channels.length > 1 ? `<div class="chs">${m.channels.map(c => `
        <div class="ch"><i class="dot" style="background:${chColor(c.name)}"></i><b>${esc(c.name)}</b><span>הוצאה <b>${fmtMoney(c.spend)}</b></span><span>לידים <b>${fmtNum(c.leads)}</b></span><span>עלות לליד <b>${fmtMoney(c.cpl)}</b></span>${m.hasPrev ? changeCell(changePct(c.cpl, c.prevCpl), true) : ''}</div>`).join('')}</div>` : ''
  const campaigns = () => m.campaigns.length ? `
    <section>${secHead('קמפיינים מובילים', 'לפי מספר הלידים בתקופה.')}
      ${channelsHtml}
      <div class="panel"><table class="data"><thead><tr><th>קמפיין</th><th>ערוץ</th><th class="num">הוצאה</th><th class="wide">לידים</th><th class="num">עלות לליד</th></tr></thead><tbody>
      ${m.campaigns.map(c => `<tr><td class="name">${esc(c.name)}</td><td class="muted"><i class="dot" style="background:${chColor(c.platform)}"></i>${esc(c.platform)}</td><td class="num">${fmtMoney(c.spend)}</td><td class="bt"><span class="bv">${fmtNum(c.leads)}</span>${bar(c.leads, cMax, chColor(c.platform))}</td><td class="num strong">${fmtMoney(c.cpl)}</td></tr>`).join('')}
      </tbody></table></div>
    </section>` : ''

  // 8) מקורות הגעה: דונאט + טבלה עם פגישות והשוואה
  const withMeet = m.sources.some(s => s.meetings != null)
  const sources = () => m.sources.length ? `
    <section>${secHead('מקורות הגעה', 'מאיפה הגיעו הלידים, לפי מה שנרשם ב-CRM.')}
      <div class="panel src">
        ${donut(m.sources.map(s => ({ name: s.name, count: s.leads })), { center: fmtNum(m.sourcesTotal), centerLabel: 'לידים', total: m.sourcesTotal, legend: false })}
        <table class="data"><thead><tr><th>מקור</th><th class="num">לידים</th><th class="num">מהלידים</th>${withMeet ? '<th class="num">פגישות שתואמו</th>' : ''}${m.hasPrev ? `<th class="num">${esc(m.prevLabel)}</th><th class="num">שינוי</th>` : ''}</tr></thead><tbody>
        ${m.sources.map((s, i) => `<tr><td class="name"><i class="dot" style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(s.name)}</td><td class="num strong">${fmtNum(s.leads)}</td><td class="num muted">${pctTxt(m.sourcesTotal ? (s.leads / m.sourcesTotal) * 100 : null)}</td>${withMeet ? `<td class="num">${fmtNum(s.meetings)}</td>` : ''}${m.hasPrev ? `<td class="num muted">${fmtNum(s.prevLeads)}</td><td class="num">${changeCell(changePct(s.leads, s.prevLeads))}</td>` : ''}</tr>`).join('')}
        </tbody></table>
      </div>
    </section>` : ''

  // 11) מה השתנה מהחודש הקודם: ההדגשה + כל המדדים מול התקופה הקודמת
  const hl = m.highlight
  const summary = () => m.hasPrev && m.kpis.some(k => k.prev != null) ? `
    <section>${secHead('מה השתנה מהחודש הקודם', `${m.label} מול ${m.prevLabel} - אותם ימים בחודש הקודם.`)}
      ${hl ? `<div class="hl" style="${toneStyle(hl.good ? 'emerald' : 'terra')}"><span class="hl-k">השינוי הבולט</span><b>${esc(hl.label)} ${hl.up ? 'עלה' : 'ירד'} ב-${Math.abs(Math.round(hl.change))}%</b> <span>מ-${esc(fmtVal(hl.prev, hl.money))} ל-${esc(fmtVal(hl.value, hl.money))}</span></div>` : ''}
      <div class="panel"><table class="data"><thead><tr><th>מדד</th><th class="num">${esc(m.label)}</th><th class="num">${esc(m.prevLabel)}</th><th class="num">שינוי</th><th>משמעות</th></tr></thead><tbody>
      ${m.kpis.filter(k => k.prev != null).map(k => {
        const good = k.change == null || Math.abs(k.change) < 0.5 ? null : (k.isCost ? k.change < 0 : k.change > 0)
        return `<tr><td class="name">${esc(k.label)}</td><td class="num strong">${esc(fmtVal(k.value, k.money))}</td><td class="num muted">${esc(fmtVal(k.prev, k.money))}</td><td class="num">${changeCell(k.change, k.isCost)}</td><td class="muted">${good == null ? 'ללא שינוי משמעותי' : good ? 'שיפור' : 'ירידה'}</td></tr>`
      }).join('')}
      </tbody></table></div>
    </section>` : ''

  // 12) מודעות פייסבוק. תמונה: רק http(s) או נתיב מהאתר (/demo/… בדמו). תמונה שלא נטענת
  // (קישור של Meta שפג) — מוסתרת, ונשאר המלבן האפור עם השם.
  const adImg = (u) => /^https?:\/\//i.test(u) ? u : (/^\/[^/]/.test(u) ? assetBase + u : '')
  const topAds = m.topAds || []
  const ads = () => topAds.length ? `
    <section>${secHead('המודעות המובילות בפייסבוק', 'לפי מספר הלידים בתקופה. מודעה זהה בכמה קבוצות נספרת פעם אחת.')}<span class="sr">TOP ADS</span>
      <div class="ads">${topAds.map((a, i) => {
        const src = adImg(a.image || '')
        return `
        <div class="ad"><div class="ad-media">${src ? `<img src="${esc(src)}" alt="" onerror="this.remove()">` : ''}<span class="ad-rank">#${i + 1}</span>${a.isVideo ? '<span class="ad-tag">VIDEO</span>' : ''}</div>
          <div class="ad-name">${esc(a.name)}</div>
          <div class="ad-m"><div><span>לידים</span><b>${fmtNum(a.leads)}</b></div><div><span>עלות לליד</span><b>${fmtMoney(a.cpl)}</b></div><div><span>הוצאה</span><b>${fmtMoney(a.spend)}</b></div></div>
        </div>`
      }).join('')}
      </div>
    </section>` : ''

  // המספור לפי סדר ההופעה — לכן כל סעיף נבנה רק כאן, ברצף.
  const sectionsHtml = [funnel, campaigns, sources, () => handlingHtml(m.handling), () => profileHtml(m.handling, m.profile), summary, ads].map(f => f()).join('')

  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800;900&display=swap">
<style>
  /* הטוקנים של הדשבורד (vitas-visual.css) */
  :root { --text: #142044; --muted: #586581; --faint: #8a93a8; --line: #e3e8f5; --soft: #f6f8ff; --track: #edf0f8;
          --good: #0f7a5c; --good-bg: #e3f6ef; --bad: #b3261e; --bad-bg: #fde8e8; }
  @page { size: A4; margin: 10mm 11mm 12mm; }
  * { box-sizing: border-box; }
  html, body { background: #fff; }
  body { font-family: 'Heebo', Arial, sans-serif; color: var(--text); margin: 0; font-size: 12px; line-height: 1.5; font-weight: 500;
         -webkit-font-smoothing: antialiased; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .wrap { max-width: 188mm; margin: 0 auto; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

  /* מעטפת: thead חוזר בראש כל עמוד מודפס — כך הלוגו מופיע בכל עמוד A4 (ויטלי, 25.10). */
  table.pg { width: 100%; border-collapse: collapse; }
  table.pg > thead > tr > td, table.pg > tbody > tr > td { padding: 0; border: 0; }
  .ph { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 0 10px; margin-bottom: 14px; border-bottom: 1px solid var(--text); }
  .ph img { display: block; inline-size: 92px; block-size: auto; }
  .ph-t { text-align: left; font-size: 10.5px; color: var(--muted); }
  .ph-t b { display: block; color: var(--text); font-size: 11px; }

  /* 3-4) לקוח + פרויקט, תקופה */
  .cover { margin: 2px 0 16px; }
  h1 { font-size: 30px; line-height: 1.15; margin: 0 0 10px; font-weight: 800; }
  h1 .sl { color: var(--faint); font-weight: 500; margin: 0 6px; }
  .periods { display: flex; flex-wrap: wrap; gap: 6px; }
  .pill { display: inline-flex; gap: 6px; align-items: baseline; padding: 4px 12px; background: var(--soft); border: 1px solid var(--line); border-radius: 999px; font-size: 11px; color: var(--muted); }
  .pill b { color: var(--text); font-weight: 700; }

  /* 5) כרטיסים צבעוניים (vr-metric) */
  .kgroup { margin-bottom: 12px; }
  .gh { font-size: 14px; font-weight: 800; margin: 0 0 7px; display: flex; align-items: center; gap: 7px; }
  .gh::before { content: ''; width: 4px; height: 15px; border-radius: 2px; background: #4559df; }
  .metrics { display: grid; gap: 8px; }
  .metric { color: #fff; border-radius: 12px; padding: 12px 13px 11px; min-height: 92px; break-inside: avoid; }
  .m-l { font-size: 11.5px; font-weight: 600; opacity: .92; }
  .m-v { font-size: 24px; line-height: 1.2; font-weight: 800; font-variant-numeric: tabular-nums; margin-top: 4px; }
  .m-h { font-size: 10px; opacity: .8; }
  .m-c { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; font-size: 10.5px; }
  .m-c span:not(.mchip) { opacity: .85; }
  .mchip { display: inline-block; background: #fff; border-radius: 999px; padding: 0 7px; font-size: 10.5px; font-weight: 800; }
  .mchip.good { color: var(--good); } .mchip.bad { color: var(--bad); } .mchip.flat { color: var(--muted); }

  /* סעיפים */
  section { margin-top: 22px; }
  .sec-head, h3, .chs { break-after: avoid; }
  tr, .metrics, .stats, .stat, .hl, .panel.funnel, .donut, .columns, .grid2 > .panel, .ad { break-inside: avoid; }
  .sec-head { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; }
  .sec-n { flex: none; width: 28px; height: 28px; border-radius: 8px; background: #eef0fd; color: #343aa1; font-weight: 800; font-size: 13px; display: flex; align-items: center; justify-content: center; }
  h2 { font-size: 18px; line-height: 1.25; margin: 0; font-weight: 800; }
  .note { margin: 1px 0 0; font-size: 11px; color: var(--muted); }
  h3 { font-size: 12.5px; margin: 0 0 8px; font-weight: 800; }
  .panel { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; background: #fff; }
  .panel + .panel, .stats + .panel, .chs + .panel, .hl + .panel { margin-top: 10px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
  .grid2 > .panel + .panel { margin-top: 0; }

  table.data { width: 100%; border-collapse: collapse; }
  table.data th { text-align: right; font-size: 10.5px; color: var(--muted); font-weight: 600; padding: 0 8px 7px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  table.data td { padding: 7px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  table.data tr:last-child td { border-bottom: 0; }
  th.num, td.num { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
  th.wide { width: 32%; }
  td.name { font-weight: 600; max-width: 64mm; overflow-wrap: anywhere; }
  .strong { font-weight: 800; }
  .muted, .was { color: var(--faint); }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-inline-end: 6px; vertical-align: 1px; }
  .chg { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 700; background: var(--track); color: var(--muted); white-space: nowrap; }
  .chg.good { background: var(--good-bg); color: var(--good); }
  .chg.bad { background: var(--bad-bg); color: var(--bad); }

  .track { display: block; height: 9px; border-radius: 999px; background: var(--track); overflow: hidden; }
  .fill { display: block; height: 100%; border-radius: 999px; }
  td.bt { min-width: 30mm; }
  td.bt .bv { display: block; font-weight: 800; font-variant-numeric: tabular-nums; margin-bottom: 3px; }
  table.barlist { width: 100%; border-collapse: collapse; }
  table.barlist td { padding: 4px 4px; border: 0; vertical-align: middle; }
  table.barlist td.name { font-weight: 600; font-size: 11px; max-width: 34mm; }
  table.barlist td.bt { width: 46%; min-width: 0; }
  table.barlist td.num { width: 1%; font-size: 11px; }

  /* 6) משפך */
  .funnel { padding: 14px 14px 10px; }
  .f-row { display: grid; grid-template-columns: 26mm 1fr 34mm; align-items: center; gap: 10px; }
  .f-l { font-weight: 700; }
  .f-c { display: flex; justify-content: center; }
  .f-bar { color: #fff; font-weight: 800; font-size: 13px; text-align: center; padding: 6px 0; border-radius: 8px; font-variant-numeric: tabular-nums; }
  .f-p { display: flex; gap: 6px; align-items: center; font-size: 10.5px; }
  .f-rate { text-align: center; font-size: 10px; color: var(--muted); margin: 2px 0; }
  .f-rate span { background: var(--soft); border: 1px solid var(--line); border-radius: 999px; padding: 0 8px; }

  /* 7) ערוצים */
  .chs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .ch { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; background: var(--soft); border: 1px solid var(--line); border-radius: 12px; padding: 9px 12px; font-size: 11px; color: var(--muted); }
  .ch > b { color: var(--text); font-size: 13px; margin-inline-end: 4px; }
  .ch span b { color: var(--text); font-variant-numeric: tabular-nums; }
  .ch .dot { margin-inline-end: 0; }

  /* 8) דונאט */
  .donut { display: flex; align-items: center; gap: 14px; }
  .donut svg { flex: none; }
  .dn-v { font: 800 19px 'Heebo', Arial, sans-serif; fill: var(--text); }
  .dn-l { font: 500 10px 'Heebo', Arial, sans-serif; fill: var(--muted); }
  table.legend { border-collapse: collapse; flex: 1; font-size: 11px; }
  table.legend td { padding: 3px 4px; }
  table.legend td.num { width: 1%; }
  .src { display: grid; grid-template-columns: 128px 1fr; gap: 16px; align-items: center; }

  /* 9) זמני טיפול */
  .stats { display: grid; gap: 8px; }
  .stat { border: 1px solid var(--line); border-top: 4px solid; border-radius: 12px; padding: 10px 12px; }
  .kl { font-size: 11px; color: var(--muted); font-weight: 600; }
  .kv { font-size: 21px; line-height: 1.2; font-weight: 800; font-variant-numeric: tabular-nums; margin-top: 3px; }
  .kv small { font-size: 10.5px; font-weight: 600; color: var(--muted); }
  .kh { font-size: 10px; color: var(--faint); margin-top: 1px; }
  .kp { font-size: 10.5px; margin-top: 5px; min-height: 17px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .columns { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; align-items: end; }
  .col-b { text-align: center; }
  .cb-v { font-weight: 800; font-size: 12px; font-variant-numeric: tabular-nums; }
  .cb-bar { height: 70px; display: flex; align-items: flex-end; justify-content: center; border-bottom: 1px solid var(--line); }
  .cb-bar span { display: block; width: 70%; border-radius: 6px 6px 0 0; }
  .cb-l { font-size: 10px; font-weight: 600; margin-top: 4px; }
  .cb-p { font-size: 10px; color: var(--faint); }

  /* 11) מה השתנה */
  .hl { color: #fff; border-radius: 12px; padding: 12px 16px; font-size: 14px; }
  .hl b { font-weight: 800; }
  .hl-k { display: block; font-size: 10.5px; font-weight: 700; opacity: .85; margin-bottom: 2px; }

  /* 12) מודעות: 3 בשורה, המדיה בשלמותה (contain) על רקע בהיר — כמו בגלריה בדשבורד */
  .ads { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .ad { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
  .ad-media { position: relative; aspect-ratio: 1 / 1; background: var(--soft); }
  .ad-media img { display: block; width: 100%; height: 100%; object-fit: contain; }
  .ad-rank, .ad-tag { position: absolute; top: 8px; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 999px; }
  .ad-rank { inset-inline-start: 8px; background: rgba(20,32,68,.86); color: #fbbf24; }
  .ad-tag { inset-inline-end: 8px; background: #fff; color: var(--text); border: 1px solid var(--line); letter-spacing: .5px; }
  .ad-name { font-size: 11px; font-weight: 700; line-height: 1.35; padding: 8px 10px 6px; min-height: 2.7em; overflow-wrap: anywhere; unicode-bidi: plaintext; }
  .ad-m { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid var(--line); margin-top: auto; }
  .ad-m div { padding: 6px 4px 8px; text-align: center; }
  .ad-m div + div { border-inline-start: 1px solid var(--line); }
  .ad-m span { display: block; font-size: 9.5px; color: var(--muted); }
  .ad-m b { font-size: 13px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .ad-m div:first-child b { color: #059669; }

  .noprint { margin: 14px auto 0; text-align: center; font-size: 12px; color: var(--muted); }
  .noprint button { font: 700 13px 'Heebo', Arial, sans-serif; padding: 9px 22px; border-radius: 10px; border: 0; background: #4559df; color: #fff; cursor: pointer; }
  .noprint button:hover { background: #343aa1; }
  @media screen { .wrap { padding: 10mm 0 16mm; } }
  @media print { .noprint { display: none; } }
</style></head>
<body><div class="wrap">
  <div class="noprint"><button type="button" onclick="window.print()">שמירה כ-PDF</button><div>בחלון ההדפסה בוחרים "שמירה כ-PDF".</div></div>
  <table class="pg"><thead><tr><td>
    <div class="ph"><img src="${logo}" alt="VITAS Campaign Manager"><div class="ph-t"><b>דוח ביצועים</b>${esc(m.client ? m.client + ' · ' : '')}${esc(m.project)} · ${esc(m.label)}</div></div>
  </td></tr></thead><tbody><tr><td>
  <div class="cover">
    <h1>${m.client ? `${esc(m.client)}<span class="sl">/</span>` : ''}${esc(m.project)}</h1>
    <div class="periods">
      <span class="pill">תקופה <b>${esc(m.label)}</b></span>
      ${m.hasPrev ? `<span class="pill">השוואה <b>${esc(m.prevLabel)}</b></span>` : ''}
      <span class="pill">הופק <b>${esc(date)}</b></span>
    </div>
  </div>
  ${kpis}
  ${sectionsHtml}
  </td></tr></tbody></table>
</div></body></html>`
}
