// scripts/tests/zoho-summary.smoke.mjs — בדיקת עשן לפונקציה הטהורה computeZohoSummary (שלב 4).
// הרצה:  node scripts/tests/zoho-summary.smoke.mjs
import { computeZohoSummary, filterDigitalLeads, israelDateOf } from '../../lib/crm/zoho-summary.js'
import { computeCrmRow, totalKeysFor, getPath } from '../../lib/crm/compute.js'

const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1 }
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? console.log('✓ ' + label) : fail(`${label}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`))

const rawLeads = [
  { id: 'L1', Lead_Status: 'חדש', Lead_Source: 'דיגיטל', Sub_Lead_Source: 'facebook', Created_Time: '2026-09-10T10:00:00+03:00', sumAnswerCalls: '1', timeOfLastCall: '2026-09-10T10:30:00+03:00', Owner: { name: 'נציגה א' }, field9: '', field20: 'מכשיר A', UTM_Campaign: 'Geek-Camp1', UTM_Term: 'set1', UTM_Content: 'ad1' },
  { id: 'L2', Lead_Status: 'כפול', Lead_Source: 'דיגיטל', Sub_Lead_Source: 'google', Created_Time: '2026-09-12T09:00:00+03:00', sumAnswerCalls: '0', Owner: { name: 'נציגה א' }, field9: 'יקר', field20: '' },
  { id: 'L3', Lead_Status: 'חדש', Lead_Source: 'דיגיטל', Sub_Lead_Source: 'facebook_minisite', Created_Time: '2026-09-20T09:00:00+03:00', sumAnswerCalls: '1', timeOfLastCall: '2026-09-20T12:00:00+03:00', Owner: { name: 'נציגה ב' } },   // מחוץ לטווח
  { id: 'L4', Lead_Status: 'חדש', Lead_Source: 'דיגיטל', Sub_Lead_Source: 'טלפון', Created_Time: '2026-09-11T09:00:00+03:00' },   // לא דיגיטלי מאושר
]
const deals = [
  { id: 'D1', LidID: 'L1', Stage: 'סגור', Amount: '5000', Closing_Date: '2026-09-11', cancellation_date: null, device_quantity: '2' },
  { id: 'D2', LidID: 'L3', Stage: 'סגור', Amount: '7000', Closing_Date: '2026-09-21' },   // של ליד מחוץ לטווח
]

const leads = filterDigitalLeads(rawLeads)
eq('filterDigitalLeads keeps facebook/google/facebook_* and drops others', leads.map(l => l.id), ['L1', 'L2', 'L3'])
eq('israelDateOf uses +03:00', israelDateOf('2026-09-10T23:30:00+00:00'), '2026-09-11')

const R = computeZohoSummary({ leads, deals }, { since: '2026-09-08', until: '2026-09-15' })
eq('leads in window', R.leads.map(l => l.id), ['L1', 'L2'])
eq('linked deals restricted to window leads', R.linkedDeals.map(d => d.id), ['D1'])
eq('totals', [R.summary.totalLeads, R.summary.relevantLeads, R.summary.irrelevantLeads], [2, 1, 1])
eq('deals', [R.summary.deals.opportunities, R.summary.deals.closed, R.summary.deals.revenue, R.summary.deals.devicesSold], [1, 1, 5000, 2])
eq('funnel closing rate', R.summary.funnel.conversionRate, 50)
eq('response time: 1 responded in 0.5h, 1 no response', [R.summary.responseTime.respondedCount, R.summary.responseTime.noResponseCount, R.summary.responseTime.avgHours], [1, 1, 0.5])
eq('UTM prefix stripped in campaign drill', R.summary.funnel.byChannel.find(c => c.channel === 'facebook').campaigns[0].campaign, 'Camp1')
eq('xlsxRows per sub-source', R.xlsxRows.map(r => [r.source, r.totalLeads]).sort(), [['facebook', 1], ['google', 1]])
eq('crmType + schemaVersion', [R.summary.crmType, R.summary.schemaVersion], ['zoho', 2])

// prefiltered: אותו פלט כשה-route כבר ביקש רק את הטווח
const R2 = computeZohoSummary({ leads: R.leads, deals }, { since: '2026-09-08', until: '2026-09-15', prefiltered: true })
eq('prefiltered path identical', JSON.stringify(R2.summary), JSON.stringify(R.summary))

// dispatcher
const row = computeCrmRow('zoho', { entities: { leads: rawLeads, deals } }, { since: '2026-09-08', until: '2026-09-15', key: '2026-09-08_2026-09-15' })
eq('computeCrmRow(zoho) shape', [row.row_count, row.data.length, row.summary.crmType, row.file_name], [2, 2, 'zoho', 'Zoho snapshot (computed)'])
eq('totalKeysFor(zoho) dotted paths resolve', getPath(row.summary, totalKeysFor('zoho')[3]), 1)
eq('computeCrmRow(salesforce) not yet', computeCrmRow('salesforce', { entities: {} }, { since: '2026-09-01', until: '2026-09-02', key: 'x' }), null)

if (process.exitCode) console.error('\nבדיקת העשן נכשלה'); else console.log('\n✓ בדיקת העשן עברה')
