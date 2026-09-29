// scripts/tests/bmby-summary.smoke.mjs — בדיקת עשן לפונקציה הטהורה computeBmbySummary.
// מריצה רשומות BMBY מלאכותיות קטנות דרך החישוב ובודקת שהפלט בצורה שהדשבורד מצפה לה.
// הרצה:  node scripts/tests/bmby-summary.smoke.mjs
import { computeBmbySummary } from '../../lib/crm/bmby-summary.js'
import { CRM_SCHEMA_VERSION } from '../../lib/crm/schema-version.js'

const clients = [
  { client_id: '1', client_fname: 'דנה', client_lname: 'לוי', phone_mobile: '0501111111', relevant: '1', status: 'hot', city: 'חיפה', objection: 'יקר מדי', client_stage: 'not_handeled', user_id: '7', user_name: 'נציג א', _cf: { 'שם מודעה': 'AD 1', 'מזהה מודעה': '111', 'פלטפורמת פרסום': 'facebook' } },
  { client_id: '2', client_fname: 'יוסי', client_lname: 'כהן', phone_mobile: '0502222222', relevant: '0', status: 'cold', city: 'תל אביב', user_id: '7', user_name: 'נציג א', _cf: {} },
  { client_id: '3', client_fname: 'רון', client_lname: 'בר',  phone_mobile: '0503333333', relevant: '1', status: 'hot', city: 'חיפה', user_id: '7', user_name: 'נציג א', _cf: {} },
]
const tasks = [
  { client_id: '1', type: 'lid', media_title: 'hi park | פייסבוק', create_date: '2026-09-10 09:15:00', start_date: '2026-09-10 09:15:00' },
  { client_id: '1', type: 'call', subject: 'שיחה', create_date: '2026-09-10 09:40:00', user_id: '7' },
  { client_id: '1', type: 'appointment', status: 'done', create_date: '2026-09-11 12:00:00', start_date: '2026-09-14 17:00:00', client_name: 'דנה לוי', message: 'פגישה טובה' },
  { client_id: '2', type: 'lid', media_title: 'hi park | גוגל', create_date: '2026-09-12 20:05:00', start_date: '2026-09-12 20:05:00' },
  { client_id: '3', type: 'lid', media_title: 'hi park | פייסבוק', create_date: '2026-08-20 10:00:00', start_date: '2026-08-20 10:00:00' },
  { client_id: '3', type: 'appointment', status: 'open', create_date: '2026-09-13 11:00:00', start_date: '2026-09-25 10:00:00', client_name: 'רון בר' },
]
const contracts = [
  { client_id: '3', client_fname: 'רון', client_lname: 'בר', agreement_date: '2026-09-13', contract_date: '2026-09-14', signed_date: '', list_price: '1500000' },
]
const now = new Date('2026-09-16T12:00:00+03:00')
const R = computeBmbySummary({ clients, tasks, prices: [], contracts }, { since: '2026-09-08', until: '2026-09-15', monthKey: '2026-09-08_2026-09-15', now })

const fail = (msg) => { console.error('✗ ' + msg); process.exitCode = 1 }
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? console.log('✓ ' + label) : fail(`${label}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`))

eq('totalLeads (2 LIDs in range, older LID excluded)', R.totals.totalLeads, 2)
eq('relevantLeads', R.totals.relevantLeads, 1)
eq('meetingsScheduled = appointments coordinated in range', R.totals.meetingsScheduled, 2)
eq('meetingsCompleted = held in range up to today, done', R.totals.meetingsCompleted, 1)
eq('meetingsUpcoming = open + future (relative to injected now)', R.totals.meetingsUpcoming, 1)
eq('leadsToHandle = live not_handeled queue', R.totals.leadsToHandle, 1)
eq('registrations from older lead attributed by historical LID media', R.totals.registrations, 1)
eq('registrationValue', R.totals.registrationValue, 1500000)
eq('contracts (signed in range, by contract_date)', [R.totals.contracts, R.totals.contractValue], [1, 1500000])
eq('xlsxRows one per media source', R.xlsxRows.map(r => r.source).sort(), ['hi park | גוגל', 'hi park | פייסבוק'])
eq('per-lead entries carry cid + date', R.xlsxRows.find(r => r.source === 'hi park | פייסבוק').leads.map(l => [l.cid, l.date]), [['1', '2026-09-10']])
eq('responseTimeStats: 1 responded (25 min), 1 no response', [R.responseTimeStats.respondedCount, R.responseTimeStats.noResponseCount, R.responseTimeStats.avgMinutes], [1, 1, 25])
eq('completedMeetings detail', R._completedMeetings.map(x => [x.cid, x.name, x.date]), [['1', 'דנה לוי', '2026-09-14 17:00:00']])
eq('crmReportRows: 2 period leads + 1 contract-only row (signed contract of an older lead)', [R.crmReportRows.length, R.crmReportRows.filter(r => r.contractOnly).length], [3, 1])
eq('namedLeads.all.allLeads', R.namedLeads.all.allLeads.map(e => e.name), ['דנה לוי', 'יוסי כהן'])
eq('adBreakdown node for AD 1 has adId', R.adBreakdown.find(a => a.ad === 'AD 1')?.adId, '111')
eq('not skipped (short range)', R._skippedBroken, false)
// v34 (ענף redesign): responseTimeStats.noResponseBySource/ByUser. הקבוע עלה ב-lib/crm/schema-version.js
// ולא כאן, ולכן הבדיקה נכשלה עוד לפני המיזוג של main. להעלות כאן בכל bump של CRM_SCHEMA_VERSION.
eq('schema version exported', CRM_SCHEMA_VERSION, 34)
for (const k of ['hourlyApptStats', 'hourlyLeadStats', 'hourlyContactStats', 'hourlyContactMeeting', 'noAnswerContactHour']) eq(`${k} has 24 buckets`, R[k].length, 24)
eq('dayOfWeekStats has 7 days', Object.keys(R.dayOfWeekStats).length, 7)
eq('meetingDayOfWeek has 7 days', Object.keys(R.meetingDayOfWeek).length, 7)

// דטרמיניזם: אותו קלט → אותו פלט (תנאי הכרחי לחישוב מתמונת מצב שמורה)
const R2 = computeBmbySummary({ clients, tasks, prices: [], contracts }, { since: '2026-09-08', until: '2026-09-15', monthKey: '2026-09-08_2026-09-15', now })
eq('deterministic output', JSON.stringify(R.totals) + JSON.stringify(R.namedLeads), JSON.stringify(R2.totals) + JSON.stringify(R2.namedLeads))

// ── שם מודעה לפי מזהה (ש.ברוך, 29.9) ─────────────────────────────────────────
// מ-14.8 BMBY מקבל "מזהה מודעה" בלי "שם מודעה". (1) בלי מפה: שני מזהים שונים הם שני צמתים
// ולא צומת אחד עם המזהה של הראשון. (2) עם מפה מ-ad_daily: השם, הסדרה והקמפיין מושלמים.
// (3) שם שהגיע מ-BMBY גובר על המפה.
{
  const cl = [
    { client_id: '11', relevant: '1', _cf: { 'מזהה מודעה': '901' } },
    { client_id: '12', relevant: '1', _cf: { 'מזהה מודעה': '902' } },
    { client_id: '13', relevant: '1', _cf: { 'מזהה מודעה': '901' } },
    { client_id: '14', relevant: '1', _cf: { 'שם מודעה': 'שם מ-BMBY', 'מזהה מודעה': '903' } },
  ]
  const tk = ['11', '12', '13', '14'].map((cid, i) => ({ client_id: cid, type: 'lid', media_title: 'hi park | פייסבוק', create_date: `2026-09-1${i} 10:00:00`, start_date: `2026-09-1${i} 10:00:00` }))
  const opts = { since: '2026-09-08', until: '2026-09-15', monthKey: 'x', now }
  const plain = computeBmbySummary({ clients: cl, tasks: tk, prices: [], contracts: [] }, opts).adBreakdown
  eq('id-only leads: one node per ad id, not one shared node', plain.filter(a => !a.ad).map(a => [a.adId, a.leads]).sort(), [['901', 2], ['902', 1]])
  const names = new Map([['901', { ad: 'מודעה א', adset: 'סדרה א', campaign: 'קמפיין א' }], ['903', { ad: 'לא אמור לגבור', adset: '', campaign: '' }]])
  const named = computeBmbySummary({ clients: cl, tasks: tk, prices: [], contracts: [] }, { ...opts, adNames: names }).adBreakdown
  const a901 = named.find(a => a.adId === '901')
  eq('adNames fills ad/adset/campaign by id', [a901?.ad, a901?.adset, a901?.campaign, a901?.leads], ['מודעה א', 'סדרה א', 'קמפיין א', 2])
  eq('id not in adNames stays nameless, own node', named.filter(a => a.adId === '902').map(a => [a.ad, a.leads]), [['', 1]])
  eq('BMBY ad name wins over adNames', named.find(a => a.adId === '903')?.ad, 'שם מ-BMBY')
}

if (process.exitCode) { console.error('\nבדיקת העשן נכשלה'); } else { console.log('\n✓ בדיקת העשן עברה') }
