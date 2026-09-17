// scripts/tests/salesforce-summary.smoke.mjs — בדיקת עשן לחיקוי השאילתות של Salesforce (שלב 4ב).
// הרצה:  node scripts/tests/salesforce-summary.smoke.mjs
import { emulateSalesforceQueries, computeSalesforceSummary, sfMs, businessHoursBetween } from '../../lib/crm/salesforce-summary.js'
import { computeCrmRow } from '../../lib/crm/compute.js'

const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1 }
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? console.log('✓ ' + label) : fail(`${label}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`))

// חלון: ספטמבר 2026 (היסט +03:00) — 2026-08-31T21:00Z .. 2026-09-30T20:59:59Z
const leads = [
  { Id: 'L1', CreatedDate: '2026-09-02T07:00:00.000+0000', IsConverted: true, ConvertedOpportunityId: 'O1', Status: 'Qualified', LeadSource: 'Facebook', Branch_Name__c: 'חיפה', meetingDate__c: '2026-09-05T15:30:00.000+0000', Salesman__r: { Name: 'מנהל' } },
  { Id: 'L2', CreatedDate: '2026-09-03T08:00:00.000+0000', IsConverted: false, Status: 'Nurturing', LeadSource: 'Google', Branch_Name__c: 'חיפה', meetingDate__c: '2026-10-02T10:00:00.000+0000' },
  { Id: 'L3', CreatedDate: '2026-09-04T09:00:00.000+0000', IsConverted: false, Status: 'Unqualified', LeadSource: 'Facebook', Branch_Name__c: null, Unqualified_Reason__c: 'Expensive', Other_Unqualified_Reason__c: 'ממש יקר', Name: 'ג', MobilePhone: '050' },
  { Id: 'L4', CreatedDate: '2026-08-20T09:00:00.000+0000', IsConverted: false, Status: 'לא הגיעו לפגישה', LeadSource: 'Facebook', Branch_Name__c: 'תל אביב', meetingDate__c: '2026-09-10T12:00:00.000+0000' },   // ליד ישן, פגישה בחלון
  { Id: 'L5', CreatedDate: '2026-08-31T20:30:00.000+0000', IsConverted: false, Status: 'New', LeadSource: 'Google', Branch_Name__c: 'חיפה' },   // 23:30 ב-31.8 שעון ישראל → מחוץ לחלון
]
const opportunities = [
  { Id: 'O1', CreatedDate: '2026-09-06T10:00:00.000+0000', StageName: 'הזמנה - שולמה מקדמה', TotalPrice_Opp_Product__c: 12000, ovala__c: 500, Amount: 12000, Branch_Name__c: 'חיפה', Salesman__r: { Name: 'רון' }, Buying_Purpose__c: 'מגורים' },
  { Id: 'O2', CreatedDate: '2026-09-08T10:00:00.000+0000', StageName: 'קיבל הצעת מחיר', TotalPrice_Opp_Product__c: 8000, Branch_Name__c: 'תל אביב', Salesman__r: { Name: 'דנה' } },
  { Id: 'O3', CreatedDate: '2026-09-09T10:00:00.000+0000', StageName: 'נסגר ללא הצלחה', TotalPrice_Opp_Product__c: null, Branch_Name__c: 'חיפה', Salesman__r: null, Loss_Reason__c: 'Price', Other_Loss_Reason__c: 'לא בתקציב', Name: 'הזד', Mobile__c: '052' },
]
const line_items = [
  { Id: 'I1', OpportunityId: 'O1', Product2: { Name: 'מטבח A' }, TotalPrice: 10000 },
  { Id: 'I2', OpportunityId: 'O1', Product2: { Name: 'אי' }, TotalPrice: 2000 },
  { Id: 'I3', OpportunityId: 'O2', Product2: { Name: 'מטבח A' }, TotalPrice: 8000 },
]
const lead_history = [
  { Id: 'H1', LeadId: 'L1', Field: 'Status', CreatedDate: '2026-09-02T07:30:00.000+0000' },   // 30 דקות אחרי היצירה (10:00-10:30 שעון ישראל, שעות עבודה)
  { Id: 'H2', LeadId: 'L1', Field: 'Status', CreatedDate: '2026-09-03T07:00:00.000+0000' },   // שינוי שני — לא נספר
  { Id: 'H3', LeadId: 'L2', Field: 'meetingDate__c', CreatedDate: '2026-09-03T09:00:00.000+0000' },
  { Id: 'H4', LeadId: 'L4', Field: 'meetingDate__c', CreatedDate: '2026-09-01T09:00:00.000+0000' },   // תיאום בחלון של ליד ישן
]
const E = emulateSalesforceQueries({ leads, opportunities, line_items, lead_history }, '2026-09-01', '2026-09-30')

eq('Q1-Q3 counts', [E.totalLeads, E.convertedLeads, E.meetingLeads], [3, 1, 2])
eq('Q4/Q5 meetings by meeting date (any lead age)', [E.meetingPeriodCnt, E.noShowPeriodCnt], [2, 1])
eq('Q6 byStatus rows', E.byStatusR.map(r => [r.k, r.c]).sort(), [['Nurturing', 1], ['Qualified', 1], ['Unqualified', 1]])
eq('Q7 byBranch keeps null key (pairs maps to לא ידוע)', E.byBranchR.map(r => [r.k, r.c]).sort(), [[null, 1], ['חיפה', 2]])
eq('Q13 opp stages with sums (null sum stays null)', E.oppStageR.map(r => [r.k, r.c, r.v, r.o]).sort(), [['הזמנה - שולמה מקדמה', 1, 12000, 500], ['נסגר ללא הצלחה', 1, null, null], ['קיבל הצעת מחיר', 1, 8000, null]])
eq('Q15 salesmen null name', E.salesmenR.find(r => r.k === null)?.st, 'נסגר ללא הצלחה')
eq('Q17 products', E.productsR.map(r => [r.k, r.c, r.v]).sort(), [['אי', 1, 2000], ['מטבח A', 2, 18000]])
eq('Q11 cohort rows link the converted opp', E.cohortStagesR.map(r => r.ConvertedOpportunity?.StageName), ['הזמנה - שולמה מקדמה'])
eq('Q27 meeting hour is UTC (route shifts by offset); L2 has a future meeting too', E.mtgHourR.map(r => [r.hr, r.c]), [[15, 1], [10, 1]])
eq('Q28 DAY_IN_WEEK 1=Sunday: 5.9 Saturday → 7, 2.10 Friday → 6', E.mtgDayR.map(r => [r.dw, r.c]), [[7, 1], [6, 1]])
eq('Q30 first status change per window lead only', E.hist.map(h => [h.LeadId, h.CreatedDate]), [['L1', '2026-09-02T07:30:00.000+0000'], ['L1', '2026-09-03T07:00:00.000+0000']])
eq('Q31/Q32 notes', [E.oppNotesR.length, E.leadNotesR[0]?.Other_Unqualified_Reason__c], [1, 'ממש יקר'])
eq('Q37 booking day from history in window incl. old lead', E.bookDayR.map(r => [r.b, r.d, r.c]).sort(), [['חיפה', 5, 1], ['תל אביב', 3, 1]])
eq('Q38 paid meetings by day', E.mtgDayPaidR.map(r => [r.b, r.d, r.c]), [['חיפה', 7, 1]])
eq('Q40 source×branch×stage with sum', E.srcOppR.map(r => [r.k, r.b, r.st, r.c, r.v]), [['Facebook', 'חיפה', 'הזמנה - שולמה מקדמה', 1, 12000]])
eq('businessHoursBetween 10:00→10:30 Israel = 0.5h', businessHoursBetween(sfMs('2026-09-02T07:00:00.000+0000'), sfMs('2026-09-02T07:30:00.000+0000'), 3), 0.5)

const R = computeSalesforceSummary({ entities: { leads, opportunities, line_items, lead_history } }, { since: '2026-09-01', until: '2026-09-30' })
const S = R.summary
eq('summary basics', [S.crmType, S.totalLeads, S.convertedLeads, S.meetingsScheduled, S.schemaVersion], ['salesforce', 3, 1, 2, 10])
eq('byStatus / byBranch via pairs', [S.byStatus, S.byBranch['לא ידוע']?.leads], [{ Qualified: 1, Nurturing: 1, Unqualified: 1 }, 1])
eq('funnel period', [S.funnel.opportunities, S.funnel.paid, S.funnel.quotes, S.funnel.lost, S.funnel.dealValue, S.funnel.deliveryValue], [3, 1, 2, 1, 12000, 500])
eq('funnelPeriod meetings from meetingDate window', [S.funnelPeriod.meetings, S.funnelPeriod.noShow], [2, 1])
eq('funnelCohort', [S.funnelCohort.opportunities, S.funnelCohort.paid, S.funnelCohort.paidValue, S.funnelCohort.rateLeadToPaid], [1, 1, 12000, 33.3])
eq('responseTime (business hours)', [S.responseTime.measured, S.responseTime.avgHours, S.responseTime.within1h], [1, 0.5, 100])
eq('meetingsByHour shifted to Israel (15→18, 10→13)', S.meetingsByHour, { 13: 1, 18: 1 })
eq('meetingsByDay by DAY_IN_WEEK', S.meetingsByDay, { 'שבת': 1, 'שישי': 1 })
eq('salesmen (opportunity-based, sorted by value)', S.salesmen.map(x => [x.name, x.opportunities, x.orders, x.value]), [['רון', 1, 1, 12000], ['דנה', 1, 0, 0], ['לא ידוע', 1, 0, 0]])
eq('products sorted by units', S.products.map(p => [p.name, p.units, p.value]), [['מטבח A', 2, 18000], ['אי', 1, 2000]])
eq('lossReasons mapped', S.lossReasons, [{ reason: 'מחיר', count: 1 }])
eq('unqualReasons mapped', S.unqualReasons, [{ reason: 'יקר מדי', count: 1 }])
eq('branchDetail sorted by leads, cohort fields', S.branchDetail.map(b => [b.branch, b.leads, b.opportunities, b.paid, b.cohortPaid, b.topSalesman]), [['חיפה', 2, 2, 1, 1, 'רון'], ['לא ידוע', 1, 0, 0, 0, null], ['תל אביב', 0, 1, 0, 0, 'דנה']])
eq('timing branches + lead grid shifted', [S.timing.branches, S.timing.data['הכל'].leadHour[10], S.timing.data['הכל'].bookDay], [['הכל', 'חיפה', 'לא ידוע', 'תל אביב'], 1, [0, 0, 1, 0, 1, 0, 0]])
eq('sourceFunnelByBranch', S.sourceFunnelByBranch['הכל'].Facebook, { leads: 2, scheduled: 1, arrived: 1, opportunities: 1, paid: 1, value: 12000 })
eq('xlsxRows per source', R.xlsxRows.map(r => [r.source, r.totalLeads]).sort(), [['Facebook', 2], ['Google', 1]])
eq('no error passthroughs', [S._srcFunnelErr, S._objNotesErr, S._cohortDrillErr, S.timing._err, S.responseTime.error], [null, null, null, null, undefined])
eq('computeCrmRow(salesforce)', (() => { const r = computeCrmRow('salesforce', { entities: { leads, opportunities, line_items, lead_history } }, { since: '2026-09-01', until: '2026-09-30', key: '2026-09' }); return [r.row_count, r.summary.crmType, r.file_name] })(), [3, 'salesforce', 'Salesforce snapshot (computed)'])

if (process.exitCode) console.error('\nבדיקת העשן נכשלה'); else console.log('\n✓ בדיקת העשן עברה')
