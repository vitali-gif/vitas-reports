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

if (process.exitCode) console.error('\nבדיקת העשן נכשלה'); else console.log('\n✓ בדיקת העשן עברה')
