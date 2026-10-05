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

/** תווית קריאה לתקופה: "ספטמבר 2026" או "01.09–15.09.2026". */
export function periodLabel(key) {
  if (!key) return ''
  if (!key.includes('_')) return formatMonth(key)
  const [a, b] = key.split('_')
  const d = (s) => s.split('-').reverse().join('.')            // YYYY-MM-DD → DD.MM.YYYY
  const short = (s) => s.split('-').reverse().slice(0, 2).join('.')
  return a.slice(0, 4) === b.slice(0, 4) ? `${short(a)}–${d(b)}` : `${d(a)}–${d(b)}`
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
  ['0-15m', 'עד 15 דק׳'], ['15m-1h', '15 דק׳–שעה'], ['1h-4h', '1–4 שעות'], ['4h-8h', '4–8 שעות'],
  [['8h-1d', '8h-24h'], '8–24 שעות'], ['1d-3d', '1–3 ימים'], ['3d+', 'מעל 3 ימים'],
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
    label: periodLabel(key), prevLabel: periodLabel(prevKey),
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
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const fmtNum = (v) => (v == null ? '—' : Math.round(v).toLocaleString('he-IL'))
const fmtMoney = (v) => (v == null ? '—' : '₪' + Math.round(v).toLocaleString('he-IL'))
const fmtVal = (v, money) => (money ? fmtMoney(v) : fmtNum(v))
const fmtPct = (v) => (v == null ? '' : (v > 0 ? '+' : '') + Math.round(v) + '%')

function changeCell(change, isCost) {
  if (change == null) return '<span class="chg">—</span>'
  const good = isCost ? change <= 0 : change >= 0
  const flat = Math.abs(change) < 0.5
  return `<span class="chg ${flat ? '' : good ? 'good' : 'bad'}" dir="ltr">${esc(fmtPct(change))}</span>`
}

/** מספר עמודות לכרטיסים שממלא שורות שלמות: 10 → 5, 9 → 3, 8 → 4 (ולא שורה אחרונה חצי ריקה). */
export function kpiColumns(count) {
  if (count <= 4) return Math.max(1, count)
  return [4, 5, 3].reduce((best, c) => ((c - count % c) % c < (best - count % best) % best ? c : best))
}


const fmtDuration = (min) => {
  if (min == null) return '—'
  if (min < 60) return Math.round(min) + ' דק׳'
  if (min < 48 * 60) return (Math.round(min / 6) / 10).toLocaleString('he-IL') + ' שעות'
  return (Math.round(min / 144) / 10).toLocaleString('he-IL') + ' ימים'
}
const pctTxt = (v) => (v == null ? '—' : Math.round(v) + '%')
// שינוי בנקודות אחוז (לאחוזים) — "מ-60% ל-70%" הוא +10 נק׳, לא +17%.
function ppCell(cur, prev, lowerIsBetter) {
  if (cur == null || prev == null) return ''
  const d = cur - prev
  if (Math.abs(d) < 0.5) return '<span class="chg">ללא שינוי</span>'
  const good = lowerIsBetter ? d < 0 : d > 0
  return `<span class="chg ${good ? 'good' : 'bad'}"><span dir="ltr">${d > 0 ? '+' : ''}${Math.round(d)}</span> נק׳</span>`
}

function handlingHtml(h, prevLabel) {
  if (!h) return ''
  const p = h.prev || null
  const cards = []
  if (h.total != null) cards.push(['קיבלו מענה', `${fmtNum(h.responded)} <small>מתוך ${fmtNum(h.total)} (${pctTxt(h.respondedPct)})</small>`, p ? ppCell(h.respondedPct, p.respondedPct) : ''])
  if (h.noResponse != null) cards.push(['לא קיבלו מענה', `${fmtNum(h.noResponse)} <small>(${pctTxt(h.total ? 100 - h.respondedPct : null)})</small>`, p ? changeCell(changePct(h.noResponse, p.noResponse), true) : ''])
  if (h.median != null) cards.push([h.medianLabel.replace('זמן מענה ', 'מענה ') + (h.basis === 'business' ? ' (שעות עבודה)' : ''), fmtDuration(h.median), p ? changeCell(changePct(h.median, p.median), true) : ''])
  if (h.within1h != null) cards.push(['מענה תוך שעה', pctTxt(h.within1h), p ? ppCell(h.within1h, p.within1h) : ''])
  const cardsHtml = cards.length ? `<div class="kpis" style="grid-template-columns: repeat(${cards.length}, 1fr)">${cards.map(([l, v, c]) => `
      <div class="kpi"><div class="kl">${esc(l)}</div><div class="kv">${v}</div><div class="kp">${c ? `${c} <span class="was">מול ${esc(prevLabel)}</span>` : ''}</div></div>`).join('')}</div>` : ''

  const maxB = Math.max(1, ...h.buckets.map(b => b.count))
  const bucketsHtml = h.buckets.length && h.responded ? `
      <h3>כמה זמן לקח לענות${h.basis === 'business' ? ' (בשעות עבודה)' : ''}</h3>
      <table class="bars"><tbody>${h.buckets.map(b => `
        <tr><td class="bl">${esc(b.label)}</td><td class="bt"><span class="bar" style="width:${Math.round((b.count / maxB) * 100)}%"></span></td><td class="num">${fmtNum(b.count)}</td><td class="num muted">${pctTxt(b.pct)}</td></tr>`).join('')}
      </tbody></table>` : ''

  const list = (title, rows, extra) => rows.length ? `
      <div class="col"><h3>${esc(title)}</h3><table><tbody>${rows.map(r => `<tr><td class="name">${esc(r.name)}</td><td class="num">${fmtNum(r.count)}${extra ? extra(r) : ''}</td></tr>`).join('')}</tbody></table></div>` : ''
  const cols = [
    list('לא קיבלו מענה — לפי נציג', h.byRep, r => (r.of ? ` <span class="muted">מתוך ${fmtNum(r.of)}</span>` : '')),
    list('סטטוס הלידים ב-CRM', h.statuses),
    list(h.reasonsTitle, h.reasons),
  ].filter(Boolean)

  return `
    <section>
      <h2>טיפול בלידים</h2>
      ${cardsHtml}
      ${bucketsHtml}
      ${cols.length ? `<div class="cols" style="grid-template-columns: repeat(${cols.length}, 1fr)">${cols.join('')}</div>` : ''}
    </section>`
}

export function renderReportHtml(m) {
  const date = m.generatedAt.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const title = `VITAS - ${m.project} - ${m.label}`
  const kpiCards = m.kpis.map(k => `
      <div class="kpi">
        <div class="kl">${esc(k.label)}</div>
        <div class="kv">${esc(fmtVal(k.value, k.money))}</div>
        <div class="kp">${m.hasPrev ? `${changeCell(k.change, k.isCost)} <span class="was">מול ${esc(fmtVal(k.prev, k.money))}</span>` : ''}</div>
      </div>`).join('')

  const hl = m.highlight
  const highlight = hl ? `<p class="hl ${hl.good ? 'good' : 'bad'}"><b>מה השתנה:</b> ${esc(hl.label)} ${hl.up ? 'עלה' : 'ירד'} ב-${Math.abs(Math.round(hl.change))}% — מ-${esc(fmtVal(hl.prev, hl.money))} ל-${esc(fmtVal(hl.value, hl.money))}.</p>` : ''

  const funnel = m.funnel.length ? `
    <section>
      <h2>משפך</h2>
      <table><thead><tr><th>שלב</th><th>${esc(m.label)}</th><th>אחוז מעבר</th><th>${esc(m.prevLabel)}</th><th>שינוי</th></tr></thead><tbody>
      ${m.funnel.map(s => `<tr><td>${esc(s.label)}</td><td class="num">${fmtNum(s.value)}</td><td class="num">${s.rate == null ? '' : Math.round(s.rate) + '%'}</td><td class="num">${fmtNum(s.prev)}</td><td class="num">${changeCell(changePct(s.value, s.prev))}</td></tr>`).join('')}
      </tbody></table>
    </section>` : ''

  const channels = m.channels.length ? `
    <section>
      <h2>לפי ערוץ</h2>
      <table><thead><tr><th>ערוץ</th><th>הוצאה</th><th>לידים</th><th>עלות לליד</th><th>עלות לליד — ${esc(m.prevLabel)}</th><th>שינוי</th></tr></thead><tbody>
      ${m.channels.map(c => `<tr><td>${esc(c.name)}</td><td class="num">${fmtMoney(c.spend)}</td><td class="num">${fmtNum(c.leads)}</td><td class="num">${fmtMoney(c.cpl)}</td><td class="num">${fmtMoney(c.prevCpl)}</td><td class="num">${changeCell(changePct(c.cpl, c.prevCpl), true)}</td></tr>`).join('')}
      </tbody></table>
    </section>` : ''

  const campaigns = m.campaigns.length ? `
    <section>
      <h2>5 הקמפיינים המובילים (לפי לידים)</h2>
      <table><thead><tr><th>קמפיין</th><th>ערוץ</th><th>הוצאה</th><th>לידים</th><th>עלות לליד</th></tr></thead><tbody>
      ${m.campaigns.map(c => `<tr><td class="name">${esc(c.name)}</td><td>${esc(c.platform)}</td><td class="num">${fmtMoney(c.spend)}</td><td class="num">${fmtNum(c.leads)}</td><td class="num">${fmtMoney(c.cpl)}</td></tr>`).join('')}
      </tbody></table>
    </section>` : ''

  const withMeet = m.sources.some(s => s.meetings != null)
  const sources = m.sources.length ? `
    <section>
      <h2>מקורות הגעה מובילים (CRM)</h2>
      <table><thead><tr><th>מקור</th><th>לידים</th>${withMeet ? '<th>פגישות שתואמו</th>' : ''}<th>לידים — ${esc(m.prevLabel)}</th><th>שינוי</th></tr></thead><tbody>
      ${m.sources.map(s => `<tr><td class="name">${esc(s.name)}</td><td class="num">${fmtNum(s.leads)}</td>${withMeet ? `<td class="num">${fmtNum(s.meetings)}</td>` : ''}<td class="num">${fmtNum(s.prevLeads)}</td><td class="num">${changeCell(changePct(s.leads, s.prevLeads))}</td></tr>`).join('')}
      </tbody></table>
    </section>` : ''

  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;600;700;800&display=swap">
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Assistant', Arial, sans-serif; color: #17202a; margin: 0; font-size: 12.5px; line-height: 1.5;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .wrap { max-width: 186mm; margin: 0 auto; padding: 8px 0; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #17202a; padding-bottom: 8px; margin-bottom: 12px; }
  .brand { font-weight: 800; font-size: 13px; letter-spacing: .08em; color: #315CF5; }
  h1 { font-size: 22px; margin: 2px 0 0; font-weight: 800; }
  .sub { color: #56636f; font-size: 12px; }
  .meta { text-align: left; color: #56636f; font-size: 11.5px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
  .kpi { border: 1px solid #d9dee3; border-radius: 6px; padding: 8px 10px; break-inside: avoid; }
  .kl { font-size: 11px; color: #56636f; font-weight: 600; }
  .kv { font-size: 19px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .kp { font-size: 11px; color: #56636f; min-height: 15px; }
  .chg { font-weight: 700; color: #56636f; }
  .chg.good { color: #1d7a52; } .chg.bad { color: #b4233b; }
  .was { color: #7a8691; }
  .hl { margin: 4px 0 12px; padding: 8px 12px; border-radius: 6px; background: #eef3fe; font-size: 13px; }
  .hl.bad { background: #fdf0f1; }
  section { margin-top: 12px; break-inside: avoid; }
  h2 { font-size: 14px; margin: 0 0 6px; font-weight: 800; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: right; font-size: 11px; color: #56636f; font-weight: 700; border-bottom: 1.5px solid #17202a; padding: 4px 6px; }
  td { padding: 5px 6px; border-bottom: 1px solid #e6e9ec; }
  td.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.name { max-width: 70mm; overflow-wrap: anywhere; }
  h3 { font-size: 12px; margin: 10px 0 4px; font-weight: 800; color: #3a4651; }
  .kv small { font-size: 11px; font-weight: 600; color: #56636f; }
  .muted { color: #7a8691; }
  table.bars td { border-bottom: 0; padding: 2px 6px; }
  td.bl { width: 26mm; white-space: nowrap; }
  td.bt { width: 60%; }
  .bar { display: inline-block; height: 9px; border-radius: 2px; background: #315CF5; vertical-align: middle; min-width: 2px; }
  .cols { display: grid; gap: 14px; margin-top: 4px; }
  .cols .col { min-width: 0; break-inside: avoid; }
  footer { margin-top: 16px; padding-top: 6px; border-top: 1px solid #d9dee3; color: #7a8691; font-size: 10.5px; }
  .noprint { margin: 12px auto; text-align: center; font-size: 13px; color: #56636f; }
  .noprint button { font: inherit; font-weight: 700; padding: 8px 18px; border-radius: 8px; border: 0; background: #315CF5; color: #fff; cursor: pointer; }
  @media print { .noprint { display: none; } }
</style></head>
<body><div class="wrap">
  <div class="noprint"><button type="button" onclick="window.print()">הדפסה / שמירה כ-PDF</button><div>בחלון ההדפסה בוחרים "שמירה כ-PDF".</div></div>
  <header>
    <div>
      <div class="brand">VITAS · דוח ביצועים</div>
      <h1>${esc(m.project)}</h1>
      <div class="sub">${esc(m.client ? m.client + ' · ' : '')}${esc(m.label)}${m.hasPrev ? ' · מול ' + esc(m.prevLabel) : ''}</div>
    </div>
    <div class="meta">הופק ב-${esc(date)}</div>
  </header>
  ${m.kpis.length ? `<div class="kpis" style="grid-template-columns: repeat(${kpiColumns(m.kpis.length)}, 1fr)">${kpiCards}</div>` : '<p>אין נתונים לתקופה הזו.</p>'}
  ${highlight}
  ${funnel}
  ${handlingHtml(m.handling, m.prevLabel)}
  ${channels}
  ${campaigns}
  ${sources}
  <footer>הנתונים מתוך דשבורד VITAS (reports.vitas.co.il) ליום ההפקה. שינוי באחוזים: ירוק = לטובה (בעלויות — ירידה).${m.hasPrev ? '' : ' לתקופת ההשוואה אין נתונים שמורים.'}</footer>
</div></body></html>`
}
