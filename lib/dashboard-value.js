/**
 * lib/dashboard-value.js — טאב "ערך הדשבורד" באדמין (D8, ויטלי 27.10: "לבנות את שניהם").
 *
 * מה השתפר בפרויקט מאז שהתחלנו: עלויות (לליד, לפגישה / למכירה), כמויות (לידים, פגישות, חוזים)
 * והמרות (ליד → פגישה / מכירה), חודש אחרי חודש.
 *
 * "לפני" ו"עכשיו" הם ממוצע של חודשיים מלאים: החודשיים הראשונים שיש בהם גם פרסום וגם CRM, מול
 * החודשיים המלאים האחרונים (החודש שרץ לא נספר — הוא חלקי). ממוצע ולא חודש בודד, כדי שחודש
 * חריג אחד לא יקבע את התמונה. עלויות והמרות מחושבות מהסכומים (הוצאה כוללת / לידים כוללים), לא
 * כממוצע של יחסים.
 *
 * חבילת ה-Master: "להפריד בין שיפור שנמדד לבין ייחוס סיבתי לדשבורד" — הקובץ הזה מחשב רק מה
 * שנמדד. הטאב אומר במפורש שזה לא מוכיח שהשיפור נבע מהדשבורד.
 *
 * טהור (בלי React ובלי רשת). המדדים לכל חודש — מ-buildReportModel של דוח ה-PDF, כך שהמספרים
 * זהים לדוח ולדשבורד.
 */
import { buildReportModel, periodLabel } from './report-pdf.js'

const ADDITIVE = ['spend', 'leads', 'crmLeads', 'relevant', 'meetSched', 'meetDone', 'regs', 'contracts', 'opps', 'closed', 'revenue']

/** המדדים של חודש אחד, לפי מפתח: { spend, leads, crmLeads, meetDone, ... } */
function monthMetrics(rows) {
  const m = buildReportModel({ project: '', key: '', rows, prevRows: [] })
  const out = {}
  for (const k of m.kpis) if (ADDITIVE.includes(k.key)) out[k.key] = Number(k.value) || 0
  const hasAds = rows.some(r => r.source === 'facebook' || String(r.source || '').startsWith('google'))
  const hasCrm = rows.some(r => r.source === 'crm')
  return { metrics: out, hasAds, hasCrm, crmType: m.crmType }
}

/** כל החודשים של הפרויקט (מפתחות YYYY-MM בלבד), מהישן לחדש. */
export function monthlySeries(reports, now = new Date()) {
  const il = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(now).slice(0, 7)
  const byMonth = new Map()
  for (const r of reports || []) {
    if (!/^\d{4}-\d{2}$/.test(r.month || '')) continue
    if (!byMonth.has(r.month)) byMonth.set(r.month, [])
    byMonth.get(r.month).push(r)
  }
  return [...byMonth.keys()].sort().map(month => ({ month, label: periodLabel(month), partial: month >= il, ...monthMetrics(byMonth.get(month)) }))
}

/** סכום של כמה חודשים → ממוצע חודשי, עם עלויות והמרות מהסכומים. */
function average(months) {
  const sum = {}
  for (const k of ADDITIVE) sum[k] = months.reduce((a, x) => a + (x.metrics[k] || 0), 0)
  const n = months.length || 1
  const avg = Object.fromEntries(ADDITIVE.map(k => [k, sum[k] / n]))
  const per = (a, b) => (sum[b] > 0 && sum[a] > 0 ? sum[a] / sum[b] : null)
  const rate = (a, b) => (sum[b] > 0 ? (sum[a] / sum[b]) * 100 : null)
  return {
    ...avg,
    cpl: per('spend', 'leads'),
    cpm: per('spend', 'meetDone'),
    cps: per('spend', 'closed'),
    costPerContract: per('spend', 'contracts'),
    leadToRelevant: rate('relevant', 'crmLeads'),
    leadToMeeting: rate('meetDone', 'crmLeads'),
    leadToSale: rate('closed', 'crmLeads'),
    leadToContract: rate('contracts', 'crmLeads'),
  }
}

// המדדים שבכרטיסים, לפי סדר. cost = ירידה היא שיפור; rate = אחוז; לכל מדד מוצג רק אם יש לו ערך בשני הצדדים.
const CARDS = [
  { key: 'cpl', label: 'עלות לליד', cost: true, money: true },
  { key: 'cpm', label: 'עלות לפגישה שבוצעה', cost: true, money: true },
  { key: 'cps', label: 'עלות למכירה', cost: true, money: true },
  { key: 'leads', label: 'לידים מהפרסום בחודש' },
  { key: 'meetDone', label: 'פגישות שבוצעו בחודש' },
  { key: 'closed', label: 'מכירות בחודש' },
  { key: 'contracts', label: 'חוזים בחודש' },
  { key: 'leadToRelevant', label: 'שיעור הלידים הרלוונטיים', rate: true },
  { key: 'leadToMeeting', label: 'ליד ← פגישה שבוצעה', rate: true },
  { key: 'leadToSale', label: 'ליד ← מכירה', rate: true },
]

/**
 * לפני מול עכשיו. window — כמה חודשים בכל צד (ברירת מחדל 2).
 * מחזיר null כשאין מספיק חודשים מלאים (צריך לפחות window*2, כדי שהצדדים לא יחפפו).
 */
export function valueSummary(series, { window = 2 } = {}) {
  const usesCrm = series.some(x => x.hasCrm)
  const full = series.filter(x => !x.partial && x.hasAds && (!usesCrm || x.hasCrm))
  if (full.length < window * 2) return { enough: false, fullMonths: full.length, needed: window * 2 }
  const before = full.slice(0, window), after = full.slice(-window)
  const b = average(before), a = average(after)
  const cards = CARDS.map(c => {
    const vb = b[c.key], va = a[c.key]
    if (vb == null || va == null || (vb === 0 && va === 0)) return null
    const change = c.rate ? va - vb : (vb > 0 ? ((va - vb) / vb) * 100 : null)
    const good = change == null || Math.abs(change) < (c.rate ? 0.5 : 1) ? null : (c.cost ? change < 0 : change > 0)
    return { ...c, before: vb, after: va, change, good }
  }).filter(Boolean)
  const span = (ms) => (ms.length === 1 ? ms[0].label : `${ms[0].label} - ${ms[ms.length - 1].label}`)
  return { enough: true, before: { months: before.map(x => x.month), label: span(before) }, after: { months: after.map(x => x.month), label: span(after) }, cards }
}

/** הטבלה החודשית: עלויות והמרות לכל חודש (גם החודש שרץ, מסומן כחלקי). */
export function monthlyTable(series) {
  return series.filter(x => x.hasAds || x.hasCrm).map(x => ({ month: x.month, label: x.label, partial: x.partial, ...average([x]) }))
}

/**
 * ציר הפעולות: משימות שנסגרו (vitas_tasks), משימות מישיבות שבוצעו (meeting_tasks) וניתוחי AI.
 * הקלט מ-/api/value; הפלט ממוין מהחדש לישן, עם חודש לכל פעולה (לקיבוץ).
 */
export function actionsTimeline({ tasks = [], meetingTasks = [], analyses = [] } = {}) {
  const items = [
    ...tasks.map(t => ({ kind: 'task', date: t.closed_at || t.updated_at, title: t.task_title, detail: t.metric_type ? `מדד: ${t.metric_type}` : '' })),
    ...meetingTasks.map(t => ({ kind: 'meeting', date: t.implemented_at || t.completed_at, title: t.title, detail: t.assignee_label || '' })),
    ...analyses.map(a => ({ kind: 'ai', date: a.created_at, title: a.result?.headline || 'ניתוח AI', detail: periodLabel(a.period_key) })),
  ].filter(x => x.date && x.title)
  return items.sort((x, y) => String(y.date).localeCompare(String(x.date)))
}
