// scripts/tests/dashboard-value.smoke.mjs — טאב "ערך הדשבורד" (D8): לפני מול עכשיו, טבלה חודשית, ציר פעולות.
// הרצה:  node scripts/tests/dashboard-value.smoke.mjs
import { monthlySeries, valueSummary, monthlyTable, actionsTimeline } from '../../lib/dashboard-value.js'

const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1 }
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? console.log('✓ ' + label) : fail(`${label}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`))

// BMBY: הוצאה, לידים, CRM עם פגישות שבוצעו. מרץ בלי CRM, אוקטובר חלקי.
const month = (m, spend, leads, crmLeads, meetDone, contracts, crm = true) => [
  { month: m, source: 'facebook', summary: { spend, leads, impressions: 1, clicks: 1 } },
  ...(crm ? [{ month: m, source: 'crm', summary: { totalLeads: crmLeads, relevantLeads: crmLeads / 2, meetingsScheduled: meetDone + 5, meetingsCompleted: meetDone, registrations: 1, contracts } }] : []),
]
const reports = [
  ...month('2026-03', 10000, 100, 0, 0, 0, false),
  ...month('2026-04', 10000, 100, 120, 10, 2),
  ...month('2026-05', 12000, 100, 120, 10, 2),
  ...month('2026-06', 11000, 110, 130, 12, 1),
  ...month('2026-08', 10000, 125, 150, 20, 3),
  ...month('2026-09', 10000, 125, 150, 20, 3),
  ...month('2026-10', 5000, 60, 70, 9, 1),
  { month: '2026-10-01_2026-10-26', source: 'crm', summary: { totalLeads: 999 } },   // טווח — לא נספר
]
const s = monthlySeries(reports, new Date('2026-10-27T10:00:00Z'))
eq('series: months only, sorted, running month partial', s.map(x => x.month + (x.partial ? '*' : '')), ['2026-03', '2026-04', '2026-05', '2026-06', '2026-08', '2026-09', '2026-10*'])

const v = valueSummary(s)
eq('before/after: first two full months with ads+CRM vs last two full months', [v.before.months, v.after.months], [['2026-04', '2026-05'], ['2026-08', '2026-09']])
const card = (k) => v.cards.find(c => c.key === k)
eq('CPL from sums (22000/200 → 20000/250), improvement', [Math.round(card('cpl').before), Math.round(card('cpl').after), Math.round(card('cpl').change), card('cpl').good], [110, 80, -27, true])
eq('cost per meeting and monthly meetings', [Math.round(card('cpm').before), Math.round(card('cpm').after), card('meetDone').before, card('meetDone').after, card('meetDone').good], [1100, 500, 10, 20, true])
eq('conversion in percentage points', [Math.round(card('leadToMeeting').before * 10) / 10, Math.round(card('leadToMeeting').after * 10) / 10, Math.round(card('leadToMeeting').change * 10) / 10], [8.3, 13.3, 5])
eq('no sales metrics for a BMBY project', [card('cps'), card('closed')], [undefined, undefined])

eq('not enough months → explains', valueSummary(monthlySeries(reports.filter(r => r.month <= '2026-06'), new Date('2026-10-27T10:00:00Z'))), { enough: false, fullMonths: 3, needed: 4 })

const t = monthlyTable(s)
eq('table: every month with data, partial flagged', [t.length, t[0].cpl, t[0].cpm, t[t.length - 1].partial], [7, 100, null, true])

const tl = actionsTimeline({
  tasks: [{ task_title: 'להעביר תקציב', closed_at: '2026-09-02T10:00:00Z', metric_type: 'cpl' }],
  meetingTasks: [{ title: 'יעד מענה 15 דק׳', completed_at: '2026-10-05T10:00:00Z', assignee_label: 'מכירות' }, { title: 'בלי תאריך' }],
  analyses: [{ period_key: '2026-10', created_at: '2026-10-27T11:00:00Z', result: { headline: 'העלות לליד ירדה' } }],
})
eq('timeline: newest first, undated dropped', tl.map(x => x.kind + ':' + x.title), ['ai:העלות לליד ירדה', 'meeting:יעד מענה 15 דק׳', 'task:להעביר תקציב'])

if (process.exitCode) console.error('\nבדיקת העשן נכשלה'); else console.log('\n✓ בדיקת העשן עברה')
