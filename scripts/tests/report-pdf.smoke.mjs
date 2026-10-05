// scripts/tests/report-pdf.smoke.mjs — הדוח התקופתי להדפסה (D19).
// הרצה:  node scripts/tests/report-pdf.smoke.mjs
import { buildReportModel, renderReportHtml, periodLabel, biggestChange, kpiColumns } from '../../lib/report-pdf.js'

const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1 }
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? console.log('✓ ' + label) : fail(`${label}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`))
const r = (x) => Math.round(x)

eq('period labels', [periodLabel('2026-09'), periodLabel('2026-09-01_2026-09-15'), periodLabel('2025-12-20_2026-01-10')],
  ['ספטמבר 2026', '01.09–15.09.2026', '20.12.2025–10.01.2026'])

// נדל"ן (BMBY — בלי crmType בסיכום)
const cur = [
  { source: 'facebook', summary: { spend: 30000, impressions: 900000, clicks: 9000, leads: 100 },
    data: [{ campaign: 'A', spend: 20000, leads: 80 }, { campaign: 'B', spend: 10000, leads: 20 }] },
  { source: 'google_pmax', summary: { spend: 10000, impressions: 100000, clicks: 2000, leads: 20 } },
  { source: 'crm', summary: { totalLeads: 150, relevantLeads: 60, meetingsScheduled: 20, meetingsCompleted: 10, registrations: 3, contracts: 2,
      sources: { פייסבוק: { totalLeads: 90, meetingsScheduled: 12 }, yad2: { totalLeads: 40, meetingsScheduled: 6 }, אתר: { totalLeads: 0 } } } },
]
const prev = [
  { source: 'facebook', summary: { spend: 30000, leads: 80 } },
  { source: 'google', summary: { spend: 10000, leads: 20 } },
  { source: 'crm', summary: { totalLeads: 120, relevantLeads: 50, meetingsScheduled: 16, meetingsCompleted: 8, registrations: 2, contracts: 1,
      sources: { פייסבוק: { totalLeads: 70 } } } },
]
const m = buildReportModel({ project: 'HI PARK', client: 'ש.ברוך', key: '2026-09', prevKey: '2026-08', rows: cur, prevRows: prev, now: new Date('2026-10-04T10:00:00Z') })
const k = Object.fromEntries(m.kpis.map(x => [x.key, x]))
eq('ads KPIs: spend/leads/CPL from all channels', [k.spend.value, k.leads.value, r(k.cpl.value), r(k.cpl.prev), r(k.cpl.change)], [40000, 120, 333, 400, -17])
eq('real-estate CRM KPIs incl. contracts', ['crmLeads', 'relevant', 'meetSched', 'meetDone', 'cpm', 'regs', 'contracts'].every(x => k[x]), true)
eq('cost per completed meeting', [k.cpm.value, k.cpm.prev], [4000, 5000])
eq('funnel with pass rates', m.funnel.map(s => [s.label, s.value, s.rate == null ? null : r(s.rate)]),
  [['לידים', 150, null], ['רלוונטיים', 60, 40], ['פגישות שתואמו', 20, 33], ['פגישות שבוצעו', 10, 50], ['חוזים', 2, 20]])
eq('channels', m.channels.map(c => [c.name, c.spend, c.leads]), [['Facebook', 30000, 100], ['Google', 10000, 20]])
eq('top campaigns from detailed rows', m.campaigns.map(c => [c.name, c.leads]), [['A', 80], ['B', 20]])
eq('sources: top, no zero rows, prev 0 when missing', m.sources.map(s => [s.name, s.leads, s.prevLeads]), [['פייסבוק', 90, 70], ['yad2', 40, 0]])
// חוזים +100% והרשמות +50% — בסיס קטן מ-5, מסוננים. בתיקו של 25% (לידים, פגישות) — העמוק יותר.
eq('biggest change ignores tiny bases', m.highlight && [m.highlight.label, r(m.highlight.change)], ['פגישות שבוצעו', 25])

// פיירברי — בלי הרשמות וחוזים
const fbm = buildReportModel({ project: 'אקספו', key: '2026-09', prevKey: '2026-08', rows: [{ source: 'crm', summary: { crmType: 'fireberry', totalLeads: 10 } }], prevRows: [] })
eq('fireberry: no registrations/contracts', fbm.kpis.some(x => x.key === 'contracts' || x.key === 'regs'), false)
eq('no previous data → hasPrev false, prev null', [fbm.hasPrev, fbm.kpis[0].prev], [false, null])

// זוהו
const z = buildReportModel({ project: 'BCure', key: '2026-09', prevKey: '2026-08',
  rows: [{ source: 'facebook', summary: { spend: 1000, leads: 10 } }, { source: 'crm', summary: { crmType: 'zoho', totalLeads: 50, relevantLeads: 40, deals: { opportunities: 20, closed: 5, revenue: 8000 }, bySource: { facebook: 30, google: 20 } } }],
  prevRows: [] })
eq('zoho: sales, revenue, cost per sale, bySource numbers', [Object.fromEntries(z.kpis.map(x => [x.key, x.value])).cps, z.sources.map(s => s.leads)], [200, [30, 20]])

// HTML: עברית, RTL, בורח מתווים, בלי "undefined"
const html = renderReportHtml(buildReportModel({ project: '<script>x</script>', key: '2026-09', prevKey: '2026-08', rows: cur, prevRows: prev }))
eq('html: rtl + escaped + no undefined/NaN', [html.includes('dir="rtl"'), html.includes('<script>x'), /undefined|NaN/.test(html)], [true, false, false])
eq('kpi columns fill rows', [3, 8, 9, 10, 7].map(kpiColumns), [3, 4, 3, 5, 4])
eq('biggestChange: none when no comparable', biggestChange([{ label: 'x', change: null }]), null)


// ── טיפול בלידים ──
{
  const { leadHandling } = await import('../../lib/report-pdf.js')
  // BMBY: responseTimeStats עם business; התנגדויות מ-crmRepRows
  const b = leadHandling({ crmType: 'bmby', crm: {
    responseTimeStats: { totalLids: 200, respondedCount: 160, noResponseCount: 40, medianMinutes: 900, noResponseByUser: { 'נציג א': 30, 'נציג ב': 10 },
      buckets: { '0-15m': 1 }, business: { medianMinutes: 160, buckets: { '0-15m': 10, '15m-1h': 30, '1h-4h': 70, '4h-8h': 30, '8h-1d': 15, '1d-3d': 5, '3d+': 0 } } },
    crmRepRows: [{ objections: 'מחיר' }, { objections: 'מחיר, מיקום' }, { objections: '' }] } })
  eq('bmby handling: counts, business median, within 1h', [b.total, b.responded, b.noResponse, b.respondedPct, b.median, b.basis, b.within1h], [200, 160, 40, 80, 160, 'business', 25])
  eq('bmby: 8h-1d bucket mapped, buckets sum to responded', [b.buckets.find(x => x.label === '8–24 שעות').count, b.buckets.reduce((a, x) => a + x.count, 0)], [15, 160])
  eq('bmby: no-response by rep + objections', [b.byRep.map(r => [r.name, r.count]), b.reasons.length > 0, b.reasonsTitle], [[['נציג א', 30], ['נציג ב', 10]], true, 'התנגדויות'])
  // פיירברי: אותו מבנה + byStatus
  const fb = leadHandling({ crmType: 'fireberry', crm: { byStatus: { 'לא רלוונטי שפה': 130, 'לא רלוונטי': 112, 'אין מענה': 62, 'תואמה פגישה': 27 },
    responseTimeStats: { totalLids: 344, respondedCount: 222, noResponseCount: 122, business: { medianMinutes: 110, buckets: { '0-15m': 5, '15m-1h': 21 } } } } })
  eq('fireberry: statuses sorted', fb.statuses.map(x => x.name).slice(0, 2), ['לא רלוונטי שפה', 'לא רלוונטי'])
  // זוהו: responseTime עם byAgent ו-8h-24h
  const z = leadHandling({ crmType: 'zoho', crm: { byStatus: { 'חדש': 435, 'אין מענה': 39 }, objections: { 'יקר לי': 25 },
    responseTime: { avgHours: 31.5, respondedWithin1h: 9, respondedCount: 255, noResponseCount: 800, buckets: { '8h-24h': 70, '3d+': 63 },
      byAgent: [{ name: 'א', count: 185, noResponse: 157 }, { name: 'ב', count: 10, noResponse: 0 }] } } })
  eq('zoho: totals, avg (not median), byAgent no-response', [z.total, z.median, z.medianLabel, z.within1h, z.byRep.map(r => [r.name, r.count, r.of])], [1055, 1890, 'זמן מענה ממוצע', 9, [['א', 157, 185]]])
  eq('zoho: 8h-24h bucket', z.buckets.find(x => x.label === '8–24 שעות').count, 70)
  // סיילספורס: רק חציון ואחוז תוך שעה
  const sf = leadHandling({ crmType: 'salesforce', crm: { byStatus: { Unqualified: 490 }, responseTime: { medianHours: 5.5, within1h: 14, measured: 1054 }, unqualReasons: [{ reason: 'אחר', count: 261 }] } })
  eq('salesforce: median, within1h, reasons, no noResponse', [sf.median, sf.within1h, sf.noResponse, sf.reasons[0].name, sf.reasonsTitle], [330, 14, null, 'אחר', 'סיבות לליד לא מתאים'])
  eq('no crm → null', leadHandling({ crm: null }), null)
  // בתוך הדוח: עם השוואה, ו-HTML בלי undefined
  const mh = buildReportModel({ project: 'x', key: '2026-09', prevKey: '2026-08',
    rows: [{ source: 'crm', summary: { totalLeads: 200, responseTimeStats: { totalLids: 200, respondedCount: 160, noResponseCount: 40, business: { medianMinutes: 160, buckets: { '0-15m': 40 } } } } }],
    prevRows: [{ source: 'crm', summary: { totalLeads: 100, responseTimeStats: { totalLids: 100, respondedCount: 70, noResponseCount: 30, business: { medianMinutes: 300, buckets: { '0-15m': 7 } } } } }] })
  eq('handling compared to previous period', [mh.handling.prev.respondedPct, mh.handling.prev.noResponse], [70, 30])
  const hh = renderReportHtml(mh)
  eq('handling html: section + percentage points, no undefined', [hh.includes('טיפול בלידים'), hh.includes('>+10</span> נק׳'), /undefined|NaN/.test(hh)], [true, true, false])
}

if (process.exitCode) console.error('\nבדיקת העשן נכשלה'); else console.log('\n✓ בדיקת העשן עברה')
