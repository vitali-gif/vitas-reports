/**
 * lib/crm/salesforce-summary.js — סיכום ה-CRM של Salesforce (KLOSS) מרשומות גולמיות.
 * שלב 4ב של docs/daily-ranges-plan.md.
 *
 * ה-route app/api/salesforce/fetch מחשב את הסיכום מ-40 שאילתות SOQL מצרפיות (GROUP BY / COUNT)
 * שרצות אצל Salesforce. כדי לחשב טווח כלשהו בלי לפנות ל-Salesforce, שומרים את הרשומות
 * הגולמיות (Lead, Opportunity, OpportunityLineItem, LeadHistory) ב-crm_raw, ו*מחקים* כאן את
 * תוצאות אותן שאילתות בדיוק — אותם שדות, אותם מפתחות, אותו טיפול ב-null — ואז מריצים את
 * קוד העיצוב של ה-route כמו שהוא (lib/crm/salesforce-shape.js נוצר ממנו אוטומטית).
 *
 * ה-route עצמו נשאר על SOQL בכוונה: כך compare=1 משווה בין שני מסלולים בלתי תלויים.
 *
 * שדות הרשומות (כפי שנשמרים): ראה fetchSalesforceRaw ב-route.
 */
import { shapeSalesforceSummary } from './salesforce-shape.js'

export * from './salesforce-common.js'
import { CHAIN, STAGE_PAID, STATUS_NOSHOW, STATUS_SCHEDULED, STATUS_ARRIVED, israelOffsetHours } from './salesforce-common.js'

// ── חיקוי SOQL ──────────────────────────────────────────────────────────────
/** חותמת זמן של Salesforce ("2026-09-16T07:12:00.000+0000") → ms. NaN אם ריק/לא תקין. */
export const sfMs = (s) => { if (!s) return NaN; return Date.parse(String(s).replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) }
const nz = (v) => (v === null || v === undefined || v === '') ? null : v          // SOQL: '' נשמר כ-null
const UTC_HOUR = (s) => new Date(sfMs(s)).getUTCHours()                         // HOUR_IN_DAY (UTC)
const UTC_DOW1 = (s) => new Date(sfMs(s)).getUTCDay() + 1                       // DAY_IN_WEEK (1=ראשון, UTC)
const relName = (rel) => (rel && typeof rel === 'object') ? nz(rel.Name) : nz(rel)

/** GROUP BY: מפתח מורכב → שורות {…keys, c, v?, o?, am?}. sums עוברים כ-null אם כל הערכים null (כמו SUM ב-SOQL). */
function groupRows(rows, keyOf, keyNames, sums = {}) {
  const m = new Map()
  for (const r of rows) {
    const keys = keyOf(r)
    const id = JSON.stringify(keys)
    let g = m.get(id)
    if (!g) { g = { keys, c: 0, sums: {} }; for (const s of Object.keys(sums)) g.sums[s] = null; m.set(id, g) }
    g.c++
    for (const [s, fn] of Object.entries(sums)) { const v = fn(r); if (v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v))) g.sums[s] = (g.sums[s] || 0) + Number(v) }
  }
  return [...m.values()].map(g => { const out = {}; keyNames.forEach((n, i) => { out[n] = g.keys[i] }); out.c = g.c; for (const s of Object.keys(sums)) out[s] = g.sums[s]; return out })
}

/**
 * מחקה את תוצאות כל 40 השאילתות של ה-route מתוך הרשומות הגולמיות.
 * @param {{leads:any[], opportunities:any[], line_items:any[], lead_history:any[]}} e
 */
export function emulateSalesforceQueries(e, since, until) {
  const off = israelOffsetHours(since)
  const sign = off >= 0 ? '+' : '-', pad = String(Math.abs(off)).padStart(2, '0')
  const fromMs = Date.parse(`${since}T00:00:00${sign}${pad}:00`)
  const toMs = Date.parse(`${until}T23:59:59${sign}${pad}:00`) + 999
  const inW = (ts) => { const t = sfMs(ts); return !Number.isNaN(t) && t >= fromMs && t <= toMs }

  const leadsAll = (e.leads || []).filter(l => l && l.Id)
  const oppsAll = (e.opportunities || []).filter(o => o && o.Id)
  const itemsAll = (e.line_items || []).filter(i => i && i.OpportunityId)
  const histAll = (e.lead_history || []).filter(h => h && h.LeadId)
  const oppById = new Map(oppsAll.map(o => [o.Id, o]))
  const leadById = new Map(leadsAll.map(l => [l.Id, l]))

  // LW / OW
  const L = leadsAll.filter(l => inW(l.CreatedDate))
  const O = oppsAll.filter(o => inW(o.CreatedDate))
  const Oset = new Set(O.map(o => o.Id))
  const LI = itemsAll.filter(i => Oset.has(i.OpportunityId))
  const conv = L.filter(l => l.IsConverted === true || l.IsConverted === 'true')
  const convOpp = (l) => (l.ConvertedOpportunityId && oppById.get(l.ConvertedOpportunityId)) || null
  const cohortOppIds = new Set(conv.map(l => l.ConvertedOpportunityId).filter(Boolean))
  const hasMeeting = (l) => nz(l.meetingDate__c) !== null
  const st = (l) => nz(l.Status)
  const br = (x) => nz(x && x.Branch_Name__c)

  const E = {}
  // Q1-Q5
  E.totalLeads = L.length
  E.convertedLeads = conv.length
  E.meetingLeads = L.filter(hasMeeting).length
  const meetingInW = leadsAll.filter(l => inW(l.meetingDate__c))
  E.meetingPeriodCnt = meetingInW.length
  E.noShowPeriodCnt = meetingInW.filter(l => st(l) === STATUS_NOSHOW).length
  // Q6-Q12
  E.byStatusR = groupRows(L, l => [st(l)], ['k'])
  E.byBranchR = groupRows(L, l => [br(l)], ['k'])
  E.bySourceR = groupRows(L, l => [nz(l.LeadSource)], ['k'])
  E.reasonsR = groupRows(L.filter(l => nz(l.Unqualified_Reason__c) !== null), l => [l.Unqualified_Reason__c], ['k'])
  E.competitorsR = groupRows(L.filter(l => nz(l.Competitor_Name__c) !== null), l => [l.Competitor_Name__c], ['k'])
  const cohortRow = (l) => { const o = convOpp(l); return { Branch_Name__c: nz(l.Branch_Name__c), ConvertedOpportunity: o ? { StageName: nz(o.StageName), TotalPrice_Opp_Product__c: o.TotalPrice_Opp_Product__c ?? null, Salesman__r: relName(o.Salesman__r) ? { Name: relName(o.Salesman__r) } : null } : null } }
  E.cohortStagesR = conv.map(cohortRow)
  E.unqualByBranchR = groupRows(L.filter(l => nz(l.Unqualified_Reason__c) !== null), l => [br(l), l.Unqualified_Reason__c], ['b', 'k'])
  // Q13-Q19
  E.oppStageR = groupRows(O, o => [nz(o.StageName)], ['k'], { v: o => o.TotalPrice_Opp_Product__c, o: o => o.ovala__c, am: o => o.Amount })
  E.oppBranchR = groupRows(O, o => [br(o)], ['k'], { v: o => o.TotalPrice_Opp_Product__c })
  E.salesmenR = groupRows(O, o => [relName(o.Salesman__r), nz(o.StageName)], ['k', 'st'], { v: o => o.TotalPrice_Opp_Product__c })
  E.purposeR = groupRows(O.filter(o => nz(o.Buying_Purpose__c) !== null), o => [o.Buying_Purpose__c], ['k'])
  const prodName = (i) => relName(i.Product2)
  E.productsR = groupRows(LI, i => [prodName(i)], ['k'], { v: i => i.TotalPrice })
  E.lossReasonR = groupRows(O.filter(o => nz(o.Loss_Reason__c) !== null), o => [o.Loss_Reason__c], ['k'])
  E.lossByBranchR = groupRows(O.filter(o => nz(o.Loss_Reason__c) !== null), o => [br(o), o.Loss_Reason__c], ['b', 'k'])
  // Q20-Q29
  E.noShowR = groupRows(L.filter(l => st(l) === STATUS_NOSHOW), l => [br(l)], ['k'])
  E.arrivedBranchR = groupRows(L.filter(l => STATUS_ARRIVED.includes(st(l))), l => [br(l)], ['k'])
  E.schedBranchR = groupRows(L.filter(l => st(l) === STATUS_SCHEDULED), l => [br(l)], ['k'])
  E.mtgBranchR = groupRows(L.filter(hasMeeting), l => [br(l)], ['k'])
  E.stageBranchR = groupRows(O, o => [br(o), nz(o.StageName)], ['k', 'st'], { v: o => o.TotalPrice_Opp_Product__c })
  E.salesBranchR = groupRows(O, o => [br(o), relName(o.Salesman__r), nz(o.StageName)], ['k', 'n', 'st'], { v: o => o.TotalPrice_Opp_Product__c })
  E.prodBranchR = groupRows(LI, i => [br(oppById.get(i.OpportunityId)), prodName(i)], ['k', 'n'], { v: i => i.TotalPrice })
  E.mtgHourR = groupRows(L.filter(hasMeeting), l => [UTC_HOUR(l.meetingDate__c)], ['hr'])
  E.mtgDayR = groupRows(L.filter(hasMeeting), l => [UTC_DOW1(l.meetingDate__c)], ['dw'])
  E.branchCohortR = conv.map(cohortRow)
  // Q30 — LeadHistory (Status), ORDER BY LeadId, CreatedDate
  const Lset = new Set(L.map(l => l.Id))
  E.hist = histAll.filter(h => h.Field === 'Status' && Lset.has(h.LeadId))
    .map(h => { const l = leadById.get(h.LeadId) || {}; return { LeadId: h.LeadId, CreatedDate: h.CreatedDate, Lead: { CreatedDate: l.CreatedDate ?? h.Lead?.CreatedDate ?? null, Branch_Name__c: nz(l.Branch_Name__c ?? h.Lead?.Branch_Name__c), meetingDate__c: nz(l.meetingDate__c ?? h.Lead?.meetingDate__c) } } })
    .sort((a, b) => (a.LeadId < b.LeadId ? -1 : a.LeadId > b.LeadId ? 1 : (sfMs(a.CreatedDate) - sfMs(b.CreatedDate))))
  // Q31/Q32 — notes (ORDER BY CreatedDate DESC LIMIT 200)
  const desc = (a, b) => sfMs(b.CreatedDate) - sfMs(a.CreatedDate)
  E.oppNotesR = O.filter(o => nz(o.Other_Loss_Reason__c) !== null).sort(desc).slice(0, 200)
    .map(o => ({ Id: o.Id, Name: o.Name ?? null, Mobile__c: o.Mobile__c ?? null, Branch_Name__c: nz(o.Branch_Name__c), Salesman__r: relName(o.Salesman__r) ? { Name: relName(o.Salesman__r) } : null, StageName: nz(o.StageName), TotalPrice_Opp_Product__c: o.TotalPrice_Opp_Product__c ?? null, CreatedDate: o.CreatedDate, Loss_Reason__c: nz(o.Loss_Reason__c), Other_Loss_Reason__c: o.Other_Loss_Reason__c }))
  E.leadNotesR = L.filter(l => nz(l.Other_Unqualified_Reason__c) !== null).sort(desc).slice(0, 200)
    .map(l => ({ Id: l.Id, Name: l.Name ?? null, Phone: l.Phone ?? null, MobilePhone: l.MobilePhone ?? null, Email: l.Email ?? null, Branch_Name__c: nz(l.Branch_Name__c), Salesman__r: relName(l.Salesman__r) ? { Name: relName(l.Salesman__r) } : null, Status: nz(l.Status), LeadSource: nz(l.LeadSource), CreatedDate: l.CreatedDate, Unqualified_Reason__c: nz(l.Unqualified_Reason__c), Other_Unqualified_Reason__c: l.Other_Unqualified_Reason__c }))
  // Q33/Q34 — cohort drill
  E.cohortSmR = conv.map(cohortRow)
  E.cohortProdR = groupRows(itemsAll.filter(i => cohortOppIds.has(i.OpportunityId)), i => [br(oppById.get(i.OpportunityId)), prodName(i)], ['k', 'n'], { v: i => i.TotalPrice })
  // Q35-Q38 — timing
  E.leadGridR = groupRows(L, l => [br(l), UTC_DOW1(l.CreatedDate), UTC_HOUR(l.CreatedDate)], ['b', 'd', 'h'])
  E.mtgDayBrR = groupRows(L.filter(hasMeeting), l => [br(l), UTC_DOW1(l.meetingDate__c)], ['b', 'd'])
  const bookRows = histAll.filter(h => h.Field === 'meetingDate__c' && inW(h.CreatedDate))
  E.bookDayR = groupRows(bookRows, h => { const l = leadById.get(h.LeadId); return [nz(l ? l.Branch_Name__c : h.Lead?.Branch_Name__c), UTC_DOW1(h.CreatedDate)] }, ['b', 'd'])
  E.mtgDayPaidR = groupRows(L.filter(l => hasMeeting(l) && (l.IsConverted === true || l.IsConverted === 'true') && convOpp(l) && nz(convOpp(l).StageName) === STAGE_PAID), l => [br(l), UTC_DOW1(l.meetingDate__c)], ['b', 'd'])
  // Q39/Q40 — source funnel
  E.srcStatusR = groupRows(L, l => [nz(l.LeadSource), br(l), st(l)], ['k', 'b', 'st'])
  E.srcOppR = groupRows(conv, l => { const o = convOpp(l); return [nz(l.LeadSource), br(l), o ? nz(o.StageName) : null] }, ['k', 'b', 'st'], { v: l => { const o = convOpp(l); return o ? o.TotalPrice_Opp_Product__c : null } })
  return E
}

/**
 * @param {{entities: {leads:any[], opportunities:any[], line_items:any[], lead_history:any[]}}} snapshot
 * @param {{since:string, until:string}} period
 * @returns {{xlsxRows:any[], summary:object, totalLeads:number}}
 */
export function computeSalesforceSummary(snapshot, { since, until }) {
  const E = emulateSalesforceQueries(snapshot.entities || snapshot, since, until)
  return shapeSalesforceSummary(E, since)
}
