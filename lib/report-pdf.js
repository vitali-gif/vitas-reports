/**
 * lib/report-pdf.js — דוח תקופתי להדפסה / שמירה כ-PDF (D19, ויטלי 1.10 ו-4.10).
 *
 * הכפתור "ייצוא דוח" בראש הדשבורד (אדמין בלבד) מפיק דוח על התקופה שפתוחה במסך, מול
 * תקופת ההשוואה של הדשבורד (comparisonPeriodKey — חודש מול חודש קודם, חודש רץ מול אותם
 * ימים בחודש הקודם, טווח מול הטווח שלפניו). רק הנתונים החשובים: כרטיסי KPI, משפך, ערוצים,
 * קמפיינים מובילים, מקורות הגעה ושורה של "מה השתנה".
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
    .slice(0, 5)

  const handling = leadHandling(cur)
  const prevHandling = leadHandling(prev)
  if (handling && prevHandling) {
    handling.prev = { respondedPct: prevHandling.respondedPct, noResponse: prevHandling.noResponse, median: prevHandling.median, within1h: prevHandling.within1h }
  }

  return {
    project, client: client || '', key, prevKey, handling,
    label: runningMonthLabel(key, now) || periodLabel(key), prevLabel: periodLabel(prevKey),
    generatedAt: now, crmType: cur.crmType,
    kpis, channels, funnel, sources,
    campaigns: cur.campaigns.slice(0, 5),
    highlight: biggestChange(kpis),
    hasPrev: prev.hasAds || !!prev.crm,
  }
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
// עיצוב: VITAS Design System (Claude Design, 25.10) בגרסה בהירה — ויטלי, 25.10: רקע לבן, מקף רגיל
// בלבד, הלוגו בראש כל עמוד A4, בלי שורת הסבר בתחתית. טקסט #131313, מנטה #3cffd0 כמילוי
// (פסים, אריחים) ומנטה כהה #22735a לטקסט; כתום כהה #c2410c לשינוי לרעה. Heebo; Space Mono רק
// לתוויות באנגלית (אין בו עברית). כרטיסים אפורים בהירים בפינות 20px, קווים של 1px, בלי צללים.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const DASH = '-'
const fmtNum = (v) => (v == null ? DASH : Math.round(v).toLocaleString('he-IL'))
const fmtMoney = (v) => (v == null ? DASH : '₪' + Math.round(v).toLocaleString('he-IL'))
const fmtVal = (v, money) => (money ? fmtMoney(v) : fmtNum(v))
const fmtPct = (v) => (v == null ? '' : (v > 0 ? '+' : '') + Math.round(v) + '%')
const pctTxt = (v) => (v == null ? DASH : Math.round(v) + '%')

/** שינוי באחוזים כתג צבעוני: מנטה = לטובה, כתום = לרעה (בעלויות — ירידה היא לטובה). */
function changeCell(change, isCost) {
  if (change == null) return '<span class="chg">-</span>'
  const flat = Math.abs(change) < 0.5
  const good = isCost ? change <= 0 : change >= 0
  return `<span class="chg ${flat ? 'flat' : good ? 'good' : 'bad'}" dir="ltr">${esc(flat ? '0%' : fmtPct(change))}</span>`
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

const bar = (v, max) => `<span class="track"><span class="fill" style="width:${max > 0 ? Math.max(2, Math.round((n(v) / max) * 100)) : 0}%"></span></span>`

let _secN = 0
const secHead = (kicker, title, note) => `
      <div class="sec-head"><span class="sec-n">${String(++_secN).padStart(2, '0')}</span><div><div class="kicker">${esc(kicker)}</div><h2>${esc(title)}</h2>${note ? `<p class="note">${esc(note)}</p>` : ''}</div></div>`

const kpiCard = (label, valueHtml, chgHtml, wasTxt, hint) => `
        <div class="kpi"><div class="kl">${esc(label)}</div><div class="kv">${valueHtml}</div>${hint ? `<div class="kh">${esc(hint)}</div>` : ''}<div class="kp">${chgHtml || ''}${wasTxt ? ` <span class="was">${wasTxt}</span>` : ''}</div></div>`

function handlingHtml(h, prevLabel) {
  if (!h) return ''
  const p = h.prev || null
  const was = (v) => (p ? 'לפני: ' + v : '')
  const cards = []
  if (h.total != null) cards.push(kpiCard('קיבלו מענה', `${fmtNum(h.responded)} <small>מתוך ${fmtNum(h.total)} (${pctTxt(h.respondedPct)})</small>`, p ? ppCell(h.respondedPct, p.respondedPct) : '', was(pctTxt(p?.respondedPct))))
  if (h.noResponse != null) cards.push(kpiCard('לא קיבלו מענה', `${fmtNum(h.noResponse)} <small>(${pctTxt(h.total ? 100 - h.respondedPct : null)})</small>`, p ? changeCell(changePct(h.noResponse, p.noResponse), true) : '', was(fmtNum(p?.noResponse))))
  if (h.median != null) {
    // "חציוני" לא אומר כלום ללקוח (ויטלי, 25.10): זה הזמן שחצי מהלידים נענו מהר ממנו.
    const isMedian = !/ממוצע/.test(h.medianLabel)
    const label = (isMedian ? 'זמן מענה טיפוסי' : 'זמן מענה ממוצע') + (h.basis === 'business' ? ' (שעות עבודה)' : '')
    cards.push(kpiCard(label, fmtDuration(h.median), p ? changeCell(changePct(h.median, p.median), true) : '', was(fmtDuration(p?.median)), isMedian ? 'חצי מהלידים נענו מהר יותר מזה' : ''))
  }
  if (h.within1h != null) cards.push(kpiCard('מענה תוך שעה', pctTxt(h.within1h), p ? ppCell(h.within1h, p.within1h) : '', was(pctTxt(p?.within1h))))
  const cardsHtml = cards.length ? `<div class="kpis" style="grid-template-columns: repeat(${cards.length}, 1fr)">${cards.join('')}</div>` : ''

  const maxB = Math.max(1, ...h.buckets.map(b => b.count))
  const bucketsHtml = h.buckets.length && h.responded ? `
      <h3>כמה זמן לקח לענות${h.basis === 'business' ? ' (בשעות עבודה)' : ''}</h3>
      <table class="barlist"><tbody>${h.buckets.map(b => `
        <tr><td class="bl">${esc(b.label)}</td><td class="bt">${bar(b.count, maxB)}</td><td class="num">${fmtNum(b.count)}</td><td class="num muted">${pctTxt(b.pct)}</td></tr>`).join('')}
      </tbody></table>` : ''

  const list = (title, rows, extra) => {
    if (!rows.length) return ''
    const max = Math.max(1, ...rows.map(r => r.count || 0))
    return `
      <div class="col"><h3>${esc(title)}</h3><table class="barlist"><tbody>${rows.map(r => `<tr><td class="name">${esc(r.name)}</td><td class="bt short">${bar(r.count, max)}</td><td class="num">${fmtNum(r.count)}${extra ? extra(r) : ''}</td></tr>`).join('')}</tbody></table></div>`
  }
  const cols = [
    list('לא קיבלו מענה - לפי נציג', h.byRep, r => (r.of ? ` <span class="muted">מתוך ${fmtNum(r.of)}</span>` : '')),
    list('סטטוס הלידים ב-CRM', h.statuses),
    list(h.reasonsTitle, h.reasons),
  ].filter(Boolean)

  return `
    <section>${secHead('LEAD HANDLING', 'טיפול בלידים', 'מה קרה עם הלידים אחרי שנכנסו: כמה קיבלו מענה, וכמה מהר.')}
      ${cardsHtml}
      ${bucketsHtml}
      ${cols.length ? `<div class="cols" style="grid-template-columns: repeat(${Math.min(cols.length, 2)}, 1fr)">${cols.join('')}</div>` : ''}
    </section>`
}

/**
 * @param {object} m  המודל מ-buildReportModel
 * @param {{assetBase?: string}} [opts]  assetBase: מקור האתר ללוגו (החלון נפתח ריק ונכתב מבחוץ)
 */
export function renderReportHtml(m, { assetBase = '' } = {}) {
  _secN = 0
  const date = m.generatedAt.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const title = `VITAS - ${m.project} - ${m.label}`
  const logo = `${esc(assetBase)}/brand/vitas/vitas-logo-dark.png`
  const wasTxt = (k) => (m.hasPrev ? 'לפני: ' + esc(fmtVal(k.prev, k.money)) : '')

  const adKeys = new Set(['spend', 'leads', 'cpl'])
  const group = (kicker, list) => list.length ? `
      <div class="kgroup"><div class="kicker">${kicker}</div>
        <div class="kpis" style="grid-template-columns: repeat(${kpiColumns(list.length)}, 1fr)">${list.map(k => kpiCard(k.label, esc(fmtVal(k.value, k.money)), m.hasPrev ? changeCell(k.change, k.isCost) : '', wasTxt(k))).join('')}</div></div>` : ''
  const kpis = m.kpis.length
    ? group('ADVERTISING <span class="he">פרסום</span>', m.kpis.filter(k => adKeys.has(k.key))) + group('CRM <span class="he">מכירות</span>', m.kpis.filter(k => !adKeys.has(k.key)))
    : '<p>אין נתונים לתקופה הזו.</p>'

  const hl = m.highlight
  const highlight = hl ? `<div class="hl ${hl.good ? 'good' : 'bad'}"><span class="hl-k">WHAT CHANGED</span><b>${esc(hl.label)} ${hl.up ? 'עלה' : 'ירד'} ב-${Math.abs(Math.round(hl.change))}%</b> <span>מ-${esc(fmtVal(hl.prev, hl.money))} ל-${esc(fmtVal(hl.value, hl.money))}</span></div>` : ''

  // משפך: פס לכל שלב (ביחס לשלב הראשון) + "מהשלב הקודם" — כמה אחוז מהשלב שלפניו הגיעו לשלב הזה.
  const fMax = Math.max(1, ...m.funnel.map(s => s.value || 0))
  const funnel = () => m.funnel.length ? `
    <section>${secHead('FUNNEL', 'משפך', 'כל שלב ביחס לשלב שלפניו: למשל 72% מהלידים הוגדרו רלוונטיים.')}
      <table class="data funnel"><thead><tr><th>שלב</th><th class="wide"></th><th class="num">${esc(m.label)}</th><th class="num">מהשלב הקודם</th>${m.hasPrev ? `<th class="num">${esc(m.prevLabel)}</th><th class="num">שינוי</th>` : ''}</tr></thead><tbody>
      ${m.funnel.map(s => `<tr><td class="name">${esc(s.label)}</td><td class="bt">${bar(s.value, fMax)}</td><td class="num strong">${fmtNum(s.value)}</td><td class="num">${s.rate == null ? '' : Math.round(s.rate) + '%'}</td>${m.hasPrev ? `<td class="num muted">${fmtNum(s.prev)}</td><td class="num">${changeCell(changePct(s.value, s.prev))}</td>` : ''}</tr>`).join('')}
      </tbody></table>
    </section>` : ''

  const channels = () => m.channels.length ? `
    <section>${secHead('CHANNELS', 'לפי ערוץ')}
      <div class="chs" style="grid-template-columns: repeat(${m.channels.length}, 1fr)">${m.channels.map(c => `
        <div class="ch"><div class="ch-name">${esc(c.name)}</div>
          <div class="ch-row"><span>הוצאה</span><b>${fmtMoney(c.spend)}</b></div>
          <div class="ch-row"><span>לידים</span><b>${fmtNum(c.leads)}</b></div>
          <div class="ch-row ch-cpl"><span>עלות לליד</span><b>${fmtMoney(c.cpl)}</b></div>
          ${m.hasPrev ? `<div class="kp">${changeCell(changePct(c.cpl, c.prevCpl), true)} <span class="was">לפני: ${fmtMoney(c.prevCpl)}</span></div>` : ''}
        </div>`).join('')}
      </div>
    </section>` : ''

  const cMax = Math.max(1, ...m.campaigns.map(c => c.leads || 0))
  const campaigns = () => m.campaigns.length ? `
    <section>${secHead('TOP CAMPAIGNS', '5 הקמפיינים המובילים', 'לפי מספר הלידים בתקופה.')}
      <table class="data"><thead><tr><th>קמפיין</th><th>ערוץ</th><th class="num">הוצאה</th><th class="wide">לידים</th><th class="num">עלות לליד</th></tr></thead><tbody>
      ${m.campaigns.map(c => `<tr><td class="name">${esc(c.name)}</td><td class="muted">${esc(c.platform)}</td><td class="num">${fmtMoney(c.spend)}</td><td class="bt"><span class="bv">${fmtNum(c.leads)}</span>${bar(c.leads, cMax)}</td><td class="num strong">${fmtMoney(c.cpl)}</td></tr>`).join('')}
      </tbody></table>
    </section>` : ''

  const withMeet = m.sources.some(s => s.meetings != null)
  const sMax = Math.max(1, ...m.sources.map(s => s.leads || 0))
  const sources = () => m.sources.length ? `
    <section>${secHead('LEAD SOURCES · CRM', 'מקורות הגעה מובילים', 'מאיפה הגיעו הלידים, לפי מה שנרשם ב-CRM.')}
      <table class="data"><thead><tr><th>מקור</th><th class="wide">לידים</th>${withMeet ? '<th class="num">פגישות שתואמו</th>' : ''}${m.hasPrev ? `<th class="num">${esc(m.prevLabel)}</th><th class="num">שינוי</th>` : ''}</tr></thead><tbody>
      ${m.sources.map(s => `<tr><td class="name">${esc(s.name)}</td><td class="bt"><span class="bv">${fmtNum(s.leads)}</span>${bar(s.leads, sMax)}</td>${withMeet ? `<td class="num">${fmtNum(s.meetings)}</td>` : ''}${m.hasPrev ? `<td class="num muted">${fmtNum(s.prevLeads)}</td><td class="num">${changeCell(changePct(s.leads, s.prevLeads))}</td>` : ''}</tr>`).join('')}
      </tbody></table>
    </section>` : ''

  // המספור (01, 02…) לפי סדר ההופעה — לכן כל סעיף נבנה רק כאן, ברצף.
  const sectionsHtml = [funnel, () => handlingHtml(m.handling, m.prevLabel), channels, campaigns, sources].map(f => f()).join('')

  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap">
<style>
  /* VITAS Design System — טוקנים (colors_and_type.css), גרסה בהירה */
  :root {
    --ink: #131313; --card: #f4f4f4; --frame: #e4e4e4; --track: #ececec;
    --mint: #3cffd0; --mint-soft: #d9fff4; --mint-text: #1f6b54; --orange-soft: #ffe9dc; --orange-text: #b93c0a;
    --text-2: #5f5f5f; --text-3: #8a8a8a;
    --sans: 'Heebo', Helvetica, Arial, sans-serif; --mono: 'Space Mono', 'Courier New', monospace;
  }
  @page { size: A4; margin: 10mm 12mm 12mm; }
  * { box-sizing: border-box; }
  html, body { background: #fff; }
  body { font-family: var(--sans); color: var(--ink); margin: 0; font-size: 12px; line-height: 1.5; font-weight: 500;
         -webkit-font-smoothing: antialiased; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .wrap { max-width: 186mm; margin: 0 auto; }
  /* Space Mono רק לתוויות באנגלית: אין בו עברית, והריווח שלו מפרק מילים עבריות לאותיות. */
  .kicker, .hl-k, .sec-n, .ph-k, .noprint button { font-family: var(--mono); text-transform: uppercase; }
  .kicker { font-size: 9.5px; font-weight: 700; letter-spacing: 1.6px; color: var(--mint-text); }
  .kicker .he { font-family: var(--sans); letter-spacing: 0; text-transform: none; font-size: 11px; color: var(--text-2); margin-inline-start: 6px; }

  /* מעטפת: thead חוזר בראש כל עמוד מודפס — כך הלוגו מופיע בכל עמוד A4 (ויטלי, 25.10). */
  table.pg { width: 100%; border-collapse: collapse; }
  table.pg > thead > tr > td, table.pg > tbody > tr > td { padding: 0; border: 0; }
  .ph { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 0 10px; margin-bottom: 14px; border-bottom: 1px solid var(--ink); }
  .ph img { display: block; inline-size: 92px; block-size: auto; }
  .ph-t { text-align: left; }
  .ph-k { display: block; font-size: 8.5px; font-weight: 700; letter-spacing: 1.6px; color: var(--mint-text); }
  .ph-p { font-size: 10.5px; color: var(--text-2); }

  .cover { margin: 4px 0 18px; }
  h1 { font-size: 36px; line-height: 1.05; margin: 6px 0 10px; font-weight: 900; letter-spacing: -0.5px; }
  .periods { display: flex; flex-wrap: wrap; gap: 6px; }
  .pill { display: inline-flex; gap: 6px; align-items: baseline; padding: 4px 12px; border: 1px solid var(--frame); border-radius: 999px; font-size: 11px; color: var(--text-2); }
  .pill b { color: var(--ink); font-weight: 700; }

  .kgroup { margin-bottom: 12px; }
  .kgroup .kicker { margin-bottom: 6px; }
  .kpis { display: grid; gap: 8px; }
  .kpi { background: var(--card); border-radius: 20px; padding: 12px 14px; break-inside: avoid; }
  .kl { font-size: 11px; color: var(--text-2); font-weight: 600; }
  .kv { font-size: 25px; line-height: 1.15; font-weight: 800; font-variant-numeric: tabular-nums; margin-top: 3px; }
  .kv small { font-size: 11px; font-weight: 600; color: var(--text-2); }
  .kh { font-size: 10px; color: var(--text-3); margin-top: 2px; }
  .kp { font-size: 10.5px; color: var(--text-2); margin-top: 6px; min-height: 18px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .was { color: var(--text-3); }
  .chg { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 700; background: var(--track); color: var(--text-2); }
  .chg.good { background: var(--mint-soft); color: var(--mint-text); }
  .chg.bad { background: var(--orange-soft); color: var(--orange-text); }

  /* "מה השתנה" — אריח מנטה מלא (אריח צבע = ההדגשה במערכת, לא צל) */
  .hl { margin: 6px 0 4px; padding: 14px 20px; border-radius: 20px; background: var(--mint); color: #000; font-size: 15px; break-inside: avoid; }
  .hl.bad { background: #ffb38f; }
  .hl b { font-weight: 800; }
  .hl-k { display: block; font-size: 9.5px; font-weight: 700; letter-spacing: 1.6px; margin-bottom: 3px; }

  /* סעיף ארוך ממשיך לעמוד הבא במקום להשאיר חצי עמוד ריק; הכותרת לא נשארת לבד בתחתית. */
  section { margin-top: 26px; }
  .sec-head, h3 { break-after: avoid; }
  tr, .kpis, .ch, .hl, .cols .col { break-inside: avoid; }
  .sec-head { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 10px; }
  .sec-n { font-size: 11px; font-weight: 700; color: var(--ink); border: 1px solid var(--ink); border-radius: 999px; padding: 2px 8px; margin-top: 2px; }
  h2 { font-size: 21px; line-height: 1.2; margin: 1px 0 0; font-weight: 800; }
  .note { margin: 2px 0 0; font-size: 11px; color: var(--text-2); }
  h3 { font-size: 12.5px; margin: 16px 0 6px; font-weight: 700; }

  table.data { width: 100%; border-collapse: collapse; }
  table.data th { text-align: right; font-size: 10.5px; color: var(--text-2); font-weight: 600; padding: 0 8px 6px; border-bottom: 1px solid var(--ink); white-space: nowrap; }
  table.data td { padding: 8px; border-bottom: 1px solid var(--frame); vertical-align: middle; }
  table.data tr:last-child td { border-bottom: 0; }
  th.num, td.num { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
  th.wide { width: 34%; }
  td.name { font-weight: 600; max-width: 62mm; overflow-wrap: anywhere; }
  .strong { font-weight: 800; }
  .muted { color: var(--text-3); }

  /* פסים: מסילה אפורה ומילוי מנטה; הערך לידם */
  .track { display: block; height: 10px; border-radius: 999px; background: var(--track); overflow: hidden; }
  .fill { display: block; height: 100%; border-radius: 999px; background: var(--mint); }
  td.bt { min-width: 30mm; }
  td.bt .bv { display: block; font-weight: 700; font-variant-numeric: tabular-nums; margin-bottom: 3px; }
  table.funnel td.bt { width: 34%; }
  table.barlist { width: 100%; border-collapse: collapse; }
  table.barlist td { padding: 4px 6px; border: 0; vertical-align: middle; }
  table.barlist td.bl { width: 24mm; white-space: nowrap; color: var(--text-2); }
  table.barlist td.bt { width: 58%; }
  table.barlist td.bt.short { width: 36%; }
  table.barlist td.num { width: 1%; }

  .chs { display: grid; gap: 10px; }
  .ch { border: 1px solid var(--frame); border-radius: 20px; padding: 14px 16px; break-inside: avoid; }
  .ch-name { font-size: 15px; font-weight: 800; margin-bottom: 6px; }
  .ch-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-2); padding: 3px 0; border-bottom: 1px solid var(--frame); }
  .ch-row b { color: var(--ink); font-variant-numeric: tabular-nums; }
  .ch-cpl b { font-size: 15px; font-weight: 800; }

  .cols { display: grid; gap: 22px; margin-top: 4px; }
  .cols .col { min-width: 0; break-inside: avoid; }

  .noprint { margin: 14px auto 0; text-align: center; font-size: 12px; color: var(--text-2); }
  .noprint button { font-size: 12px; font-weight: 700; letter-spacing: 1.2px; padding: 10px 22px; border-radius: 24px; border: 0; background: var(--mint); color: #000; cursor: pointer; transition: background 180ms ease; }
  .noprint button:hover { background: var(--ink); color: #fff; }
  @media screen { .wrap { padding: 10mm 0 16mm; } }
  @media print { .noprint { display: none; } }
</style></head>
<body><div class="wrap">
  <div class="noprint"><button type="button" onclick="window.print()">SAVE PDF</button><div>בחלון ההדפסה בוחרים "שמירה כ-PDF".</div></div>
  <table class="pg"><thead><tr><td>
    <div class="ph"><img src="${logo}" alt="VITAS Campaign Manager"><div class="ph-t"><span class="ph-k">Performance report</span><span class="ph-p">${esc(m.project)} · ${esc(m.label)}</span></div></div>
  </td></tr></thead><tbody><tr><td>
  <div class="cover">
    <div class="kicker">PERFORMANCE REPORT${m.client ? ` <span class="he">${esc(m.client)}</span>` : ''}</div>
    <h1>${esc(m.project)}</h1>
    <div class="periods">
      <span class="pill">תקופה <b>${esc(m.label)}</b></span>
      ${m.hasPrev ? `<span class="pill">השוואה <b>${esc(m.prevLabel)}</b></span>` : ''}
      <span class="pill">הופק <b>${esc(date)}</b></span>
    </div>
  </div>
  ${kpis}
  ${highlight}
  ${sectionsHtml}
  </td></tr></tbody></table>
</div></body></html>`
}
