// API route: /api/salesforce/fetch
//   POST — from the admin UI (auth via x-client-key header = anon key)
//   GET  — from Vercel Cron (auth via Authorization: Bearer <CRON_SECRET>)
//
// Pulls KLOSS leads + opportunities from Salesforce, writes to Supabase.
//
// Verified schema (2026-06-22, live against beithasapa.my.salesforce.com):
//   Chain filter  : Lead.Chain_Name__c = 'קלוס'  |  Opportunity.Cahin_Name__c = 'קלוס'  (note the typo "Cahin")
//   Lead          : Status, LeadSource, Branch_Name__c, Salesman__c (-> Contact, Salesman__r.Name),
//                   meetingDate__c (datetime), Unqualified_Reason__c, Competitor_Name__c, IsConverted
//   Opportunity   : StageName (חדש / קיבל הצעת מחיר / הזמנה - שולמה מקדמה / נסגר ללא הצלחה),
//                   TotalPrice_Opp_Product__c (deal value), ovala__c (delivery+assembly, shown separately),
//                   Buying_Purpose__c, Branch_Name__c
//   Products      : OpportunityLineItem -> Product2.Name (cabinet types)
//   Response time : LeadHistory (Field='Status') — Lead.CreatedDate -> first status change
//
// All periods filter on CreatedDate (period reporting, same as the other clients).
//
// SAFETY: Salesforce data must ONLY be written to KLOSS-named projects. The dashboard
// live-fetch calls every CRM route with the currently-open projectId for ALL clients, so
// without this guard a Salesforce report could overwrite another client's project.
//
// Env vars: SF_CLIENT_ID, SF_CLIENT_SECRET, SF_REFRESH_TOKEN, SF_LOGIN_URL, SF_API_VERSION

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SF_LOGIN_URL = process.env.SF_LOGIN_URL || 'https://login.salesforce.com'
const SF_API_VERSION = process.env.SF_API_VERSION || 'v60.0'
const SF_SCHEMA_VERSION = 6

const CHAIN = 'קלוס'
const STAGE_PAID = 'הזמנה - שולמה מקדמה'
const STAGE_QUOTE = 'קיבל הצעת מחיר'
const STAGE_LOST = 'נסגר ללא הצלחה'
const STATUS_NOSHOW = 'לא הגיעו לפגישה'
// Lead.Status — API value vs Hebrew label (verified from the Lead describe, 2026-07-21):
//   New → חדש | Working → נוצר קשר ראשוני | אין מענה → אין מענה
//   Nurturing → תואמה פגישה בסניף | Qualified → הומר | Unqualified → לא הומר
//   לא הגיעו לפגישה → לא הגיעו לפגישה
// A "meeting" = coordinated (Nurturing) + attended/converted (Qualified) + no-show.
// 'Unqualified' (לא הומר) is deliberately NOT a meeting: its Unqualified_Reason__c values
// are mostly generic disqualifications (טעות-לא מחפש ארונות, אין מענה, לא בתקציב).
const STATUS_SCHEDULED = 'Nurturing'
const STATUS_ARRIVED = ['Qualified']
const STATUS_MEET = ['Nurturing', 'Qualified', 'לא הגיעו לפגישה']
const DOW = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת']

function currentMonth() {
  const now = new Date()
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
}
function israelOffsetHours(dateStr) {
  try {
    const d = new Date(dateStr + 'T12:00:00Z')
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', timeZoneName: 'shortOffset' }).formatToParts(d)
    const tz = (parts.find(p => p.type === 'timeZoneName') || {}).value || 'GMT+3'
    const m = /GMT([+-]\d+)/.exec(tz)
    return m ? parseInt(m[1], 10) : 3
  } catch { return 3 }
}
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n }
function r0(v) { return Math.round(num(v)) }

// ===== OAuth =====
async function getAuth() {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.SF_CLIENT_ID,
    client_secret: process.env.SF_CLIENT_SECRET,
    refresh_token: process.env.SF_REFRESH_TOKEN,
  })
  const res = await fetch(`${SF_LOGIN_URL}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  if (!res.ok) throw new Error(`SF token refresh ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const j = await res.json()
  if (j.error) throw new Error(`SF OAuth ${j.error}: ${j.error_description || ''}`)
  return { token: j.access_token, instance: j.instance_url }
}

// ===== SOQL =====
async function soql(auth, q, maxPages = 10) {
  const out = []
  let url = `${auth.instance}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(q)}`
  let page = 0
  while (url && page < maxPages) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${auth.token}` }, cache: 'no-store' })
    if (!res.ok) throw new Error(`SOQL ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const j = await res.json()
    out.push(...(j.records || []))
    url = j.done ? null : auth.instance + j.nextRecordsUrl
    page++
  }
  return out
}
async function soqlCount(auth, q) {
  const url = `${auth.instance}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(q)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${auth.token}` }, cache: 'no-store' })
  if (!res.ok) throw new Error(`SOQL ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const j = await res.json()
  return j.totalSize || 0
}
function pairs(recs, keyField, countField) {
  const m = {}
  for (const r of recs) m[(r[keyField] === null || r[keyField] === undefined || r[keyField] === '') ? 'לא ידוע' : r[keyField]] = r[countField]
  return m
}

// ===== main sync =====
async function runSync(opts = {}) {
  const { month, since: sinceOpt, until: untilOpt } = opts

  if (!process.env.SF_CLIENT_ID || !process.env.SF_CLIENT_SECRET || !process.env.SF_REFRESH_TOKEN) {
    return { status: 200, body: { ok: false, pending: true, message: 'Salesforce credentials not configured.' } }
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return { status: 500, body: { error: 'Missing Supabase credentials' } }
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  let since, until, m
  if (sinceOpt && untilOpt) { since = sinceOpt; until = untilOpt; m = `${since}_${until}` }
  else {
    const mArg = month || currentMonth()
    const [y, mm] = mArg.split('-').map(Number)
    since = `${y}-${String(mm).padStart(2, '0')}-01`
    const lastDay = new Date(y, mm, 0).getDate()
    until = `${y}-${String(mm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    m = mArg
  }
  // Period boundaries must be Israel-local midnight, not UTC midnight. Salesforce stores
  // CreatedDate in UTC, so a plain `${since}T00:00:00Z` starts the month 3 hours late and
  // drags in the first hours of the next month. Build the offset from Asia/Jerusalem (DST-aware).
  const _off = israelOffsetHours(since)
  const _sign = _off >= 0 ? '+' : '-'
  const _pad = String(Math.abs(_off)).padStart(2, '0')
  const FROM = `${since}T00:00:00${_sign}${_pad}:00`
  const TO = `${until}T23:59:59${_sign}${_pad}:00`

  const { data: projects, error: projErr } = await supabase.from('projects').select('id, name, client_id')
  if (projErr) return { status: 500, body: { error: 'Failed to load projects: ' + projErr.message } }
  const projectsList = (projects || []).filter(p =>
    (p.name || '').toLowerCase().includes('kloss') && (!opts.projectId || p.id === opts.projectId)
  )
  if (projectsList.length === 0) return { status: 200, body: { ok: false, message: 'No KLOSS project found in Supabase.' } }

  let auth
  try { auth = await getAuth() } catch (e) { return { status: 500, body: { error: 'SF OAuth failed: ' + e.message } } }

  const LW = `Chain_Name__c='${CHAIN}' AND CreatedDate>=${FROM} AND CreatedDate<=${TO}`
  const OW = `Cahin_Name__c='${CHAIN}' AND CreatedDate>=${FROM} AND CreatedDate<=${TO}`

  let totalLeads, convertedLeads, meetingLeads, byStatusR, byBranchR, bySourceR, reasonsR, competitorsR
  let oppStageR, oppBranchR, salesmenR, smLeadsR, smMeetR, purposeR, productsR
  let noShowR, arrivedBranchR, schedBranchR, mtgBranchR, stageBranchR, salesBranchR, smBrLeadsR, smBrMeetR, prodBranchR, mtgHourR, mtgDayR
  try {
    ;[totalLeads, convertedLeads, meetingLeads] = await Promise.all([
      soqlCount(auth, `SELECT COUNT() FROM Lead WHERE ${LW}`),
      soqlCount(auth, `SELECT COUNT() FROM Lead WHERE ${LW} AND IsConverted=true`),
      soqlCount(auth, `SELECT COUNT() FROM Lead WHERE ${LW} AND meetingDate__c!=null`),
    ])
    ;[byStatusR, byBranchR, bySourceR, reasonsR, competitorsR] = await Promise.all([
      soql(auth, `SELECT Status k, COUNT(Id) c FROM Lead WHERE ${LW} GROUP BY Status`),
      soql(auth, `SELECT Branch_Name__c k, COUNT(Id) c FROM Lead WHERE ${LW} GROUP BY Branch_Name__c`),
      soql(auth, `SELECT LeadSource k, COUNT(Id) c FROM Lead WHERE ${LW} GROUP BY LeadSource`),
      soql(auth, `SELECT Unqualified_Reason__c k, COUNT(Id) c FROM Lead WHERE ${LW} AND Unqualified_Reason__c!=null GROUP BY Unqualified_Reason__c`),
      soql(auth, `SELECT Competitor_Name__c k, COUNT(Id) c FROM Lead WHERE ${LW} AND Competitor_Name__c!=null GROUP BY Competitor_Name__c`),
    ])
    ;[oppStageR, oppBranchR, salesmenR, smLeadsR, smMeetR, purposeR, productsR] = await Promise.all([
      soql(auth, `SELECT StageName k, COUNT(Id) c, SUM(TotalPrice_Opp_Product__c) v, SUM(ovala__c) o, SUM(Amount) am FROM Opportunity WHERE ${OW} GROUP BY StageName`),
      soql(auth, `SELECT Branch_Name__c k, COUNT(Id) c, SUM(TotalPrice_Opp_Product__c) v FROM Opportunity WHERE ${OW} GROUP BY Branch_Name__c`),
      soql(auth, `SELECT Salesman__r.Name k, StageName st, COUNT(Id) c, SUM(TotalPrice_Opp_Product__c) v FROM Opportunity WHERE ${OW} GROUP BY Salesman__r.Name, StageName`),
      soql(auth, `SELECT Salesman__r.Name k, COUNT(Id) c FROM Lead WHERE ${LW} GROUP BY Salesman__r.Name`),
      soql(auth, `SELECT Salesman__r.Name k, COUNT(Id) c FROM Lead WHERE ${LW} AND Status IN (${STATUS_MEET.map(x => `'${x}'`).join(',')}) GROUP BY Salesman__r.Name`),
      soql(auth, `SELECT Buying_Purpose__c k, COUNT(Id) c FROM Opportunity WHERE ${OW} AND Buying_Purpose__c!=null GROUP BY Buying_Purpose__c`),
      soql(auth, `SELECT Product2.Name k, COUNT(Id) c, SUM(TotalPrice) v FROM OpportunityLineItem WHERE Opportunity.Cahin_Name__c='${CHAIN}' AND Opportunity.CreatedDate>=${FROM} AND Opportunity.CreatedDate<=${TO} GROUP BY Product2.Name`),
    ])
    ;[noShowR, arrivedBranchR, schedBranchR, mtgBranchR, stageBranchR, salesBranchR, smBrLeadsR, smBrMeetR, prodBranchR, mtgHourR, mtgDayR] = await Promise.all([
      soql(auth, `SELECT Branch_Name__c k, COUNT(Id) c FROM Lead WHERE ${LW} AND Status='${STATUS_NOSHOW}' GROUP BY Branch_Name__c`),
      soql(auth, `SELECT Branch_Name__c k, COUNT(Id) c FROM Lead WHERE ${LW} AND Status IN (${STATUS_ARRIVED.map(x => `'${x}'`).join(',')}) GROUP BY Branch_Name__c`),
      soql(auth, `SELECT Branch_Name__c k, COUNT(Id) c FROM Lead WHERE ${LW} AND Status='${STATUS_SCHEDULED}' GROUP BY Branch_Name__c`),
      soql(auth, `SELECT Branch_Name__c k, COUNT(Id) c FROM Lead WHERE ${LW} AND meetingDate__c!=null GROUP BY Branch_Name__c`),
      soql(auth, `SELECT Branch_Name__c k, StageName st, COUNT(Id) c, SUM(TotalPrice_Opp_Product__c) v FROM Opportunity WHERE ${OW} GROUP BY Branch_Name__c, StageName`),
      soql(auth, `SELECT Branch_Name__c k, Salesman__r.Name n, StageName st, COUNT(Id) c, SUM(TotalPrice_Opp_Product__c) v FROM Opportunity WHERE ${OW} GROUP BY Branch_Name__c, Salesman__r.Name, StageName`),
      soql(auth, `SELECT Branch_Name__c k, Salesman__r.Name n, COUNT(Id) c FROM Lead WHERE ${LW} GROUP BY Branch_Name__c, Salesman__r.Name`),
      soql(auth, `SELECT Branch_Name__c k, Salesman__r.Name n, COUNT(Id) c FROM Lead WHERE ${LW} AND Status IN (${STATUS_MEET.map(x => `'${x}'`).join(',')}) GROUP BY Branch_Name__c, Salesman__r.Name`),
      soql(auth, `SELECT Opportunity.Branch_Name__c k, Product2.Name n, COUNT(Id) c, SUM(TotalPrice) v FROM OpportunityLineItem WHERE Opportunity.Cahin_Name__c='${CHAIN}' AND Opportunity.CreatedDate>=${FROM} AND Opportunity.CreatedDate<=${TO} GROUP BY Opportunity.Branch_Name__c, Product2.Name`),
      soql(auth, `SELECT HOUR_IN_DAY(meetingDate__c) hr, COUNT(Id) c FROM Lead WHERE ${LW} AND meetingDate__c!=null GROUP BY HOUR_IN_DAY(meetingDate__c)`),
      soql(auth, `SELECT DAY_IN_WEEK(meetingDate__c) dw, COUNT(Id) c FROM Lead WHERE ${LW} AND meetingDate__c!=null GROUP BY DAY_IN_WEEK(meetingDate__c)`),
    ])
  } catch (e) {
    return { status: 500, body: { error: 'Salesforce query failed: ' + e.message } }
  }

  // ===== response time from LeadHistory =====
  let responseTime = { avgHours: 0, medianHours: 0, within1h: 0, within4h: 0, within24h: 0, measured: 0 }
  try {
    const hist = await soql(auth,
      `SELECT LeadId, Lead.CreatedDate, CreatedDate FROM LeadHistory WHERE Field='Status' AND Lead.Chain_Name__c='${CHAIN}' AND Lead.CreatedDate>=${FROM} AND Lead.CreatedDate<=${TO} ORDER BY LeadId, CreatedDate`, 8)
    const first = {}
    for (const h of hist) if (!(h.LeadId in first)) first[h.LeadId] = { lc: h.Lead && h.Lead.CreatedDate, hc: h.CreatedDate }
    const hrs = Object.values(first).map(v => (new Date(v.hc) - new Date(v.lc)) / 3.6e6).filter(h => h >= 0).sort((a, b) => a - b)
    const n = hrs.length
    if (n) {
      responseTime = {
        measured: n,
        avgHours: Math.round((hrs.reduce((s, h) => s + h, 0) / n) * 10) / 10,
        medianHours: Math.round(hrs[Math.floor(n / 2)] * 10) / 10,
        within1h: Math.round(hrs.filter(h => h <= 1).length / n * 100),
        within4h: Math.round(hrs.filter(h => h <= 4).length / n * 100),
        within24h: Math.round(hrs.filter(h => h <= 24).length / n * 100),
      }
    }
  } catch (e) { responseTime.error = e.message }

  // ===== shape =====
  const byStatus = pairs(byStatusR, 'k', 'c')
  const byBranchLeads = pairs(byBranchR, 'k', 'c')
  const bySourceLeads = pairs(bySourceR, 'k', 'c')
  const reasons = pairs(reasonsR, 'k', 'c')
  const competitors = pairs(competitorsR, 'k', 'c')
  const buyingPurpose = pairs(purposeR, 'k', 'c')

  let opportunities = 0, quotes = 0, paid = 0, lost = 0, dealValue = 0, deliveryValue = 0
  const byStage = {}
  for (const r of oppStageR) {
    const st = r.k || 'לא ידוע'
    byStage[st] = { count: r.c, value: r0(r.v), delivery: r0(r.o), amount: r0(r.am) }
    opportunities += r.c
    if (st === STAGE_PAID) { paid = r.c; dealValue = r0(r.v); deliveryValue = r0(r.o) }
    else if (st === STAGE_QUOTE) quotes = r.c
    else if (st === STAGE_LOST) lost = r.c
  }
  // quotes = reached quote stage or beyond (quote + paid)
  const quotesTotal = quotes + paid

  const branches = {}
  for (const k of Object.keys(byBranchLeads)) branches[k] = { leads: byBranchLeads[k], opportunities: 0, value: 0 }
  for (const r of oppBranchR) {
    const k = r.k || 'לא ידוע'
    if (!branches[k]) branches[k] = { leads: 0, opportunities: 0, value: 0 }
    branches[k].opportunities = r.c
    branches[k].value = r0(r.v)
  }

  const _rate = (a, b) => b > 0 ? Math.round(a / b * 1000) / 10 : 0
  const smAgg = {}
  const smGet = (n) => (smAgg[n] = smAgg[n] || { name: n, leads: 0, meetings: 0, opportunities: 0, quotes: 0, quotesValue: 0, orders: 0, value: 0 })
  for (const r of (smLeadsR || [])) smGet(r.k || 'לא ידוע').leads = r.c
  for (const r of (smMeetR || [])) smGet(r.k || 'לא ידוע').meetings = r.c
  for (const r of (salesmenR || [])) {
    const o = smGet(r.k || 'לא ידוע')
    o.opportunities += r.c
    if (r.st === STAGE_PAID) { o.orders = r.c; o.value = r0(r.v) }
    else if (r.st === STAGE_QUOTE) { o.quotes = r.c; o.quotesValue = r0(r.v) }
  }
  const salesmen = Object.values(smAgg).map(o => ({
    ...o,
    quotesTotal: o.quotes + o.orders,
    quotesValueTotal: o.quotesValue + o.value,
    avgDeal: o.orders ? Math.round(o.value / o.orders) : 0,
    convToMeeting: _rate(o.meetings, o.leads),
    convToDeal: _rate(o.orders, o.leads),
  })).filter(o => o.leads > 0 || o.opportunities > 0).sort((a, b) => b.value - a.value)

  const products = productsR.map(r => ({ name: r.k || 'לא ידוע', units: r.c, value: r0(r.v) }))
    .sort((a, b) => b.units - a.units)

  // ---- per-branch detail (manager drill-down) ----
  const noShowByBranch = pairs(noShowR, 'k', 'c')
  const arrivedByBranch = pairs(arrivedBranchR, 'k', 'c')
  const schedByBranch = pairs(schedBranchR, 'k', 'c')
  const _arrSet = new Set(STATUS_ARRIVED)
  let arrivedCnt = 0, noShowCnt = 0, scheduledCnt = 0
  for (const [k, v] of Object.entries(byStatus)) {
    const kk = String(k || '').trim()
    if (_arrSet.has(kk)) arrivedCnt += v
    else if (kk === STATUS_NOSHOW) noShowCnt += v
    else if (kk === STATUS_SCHEDULED) scheduledCnt += v
  }
  const meetingsTotal = arrivedCnt + noShowCnt + scheduledCnt
  const mtgByBranch = pairs(mtgBranchR, 'k', 'c')
  const bd = {}
  const bkey = (k) => (k === null || k === undefined || k === '') ? 'לא ידוע' : k
  const ensure = (k) => (bd[k] = bd[k] || { branch: k, leads: 0, meetings: 0, meetingsByDate: 0, arrived: 0, scheduled: 0, noShow: 0, opportunities: 0, quotes: 0, paid: 0, lost: 0, value: 0, delivery: 0, salesmen: [], products: [] })
  for (const [k, v] of Object.entries(byBranchLeads)) ensure(k).leads = v
  for (const [k, v] of Object.entries(mtgByBranch)) ensure(k).meetingsByDate = v
  for (const [k, v] of Object.entries(arrivedByBranch)) ensure(k).arrived = v
  for (const [k, v] of Object.entries(schedByBranch)) ensure(k).scheduled = v
  for (const [k, v] of Object.entries(noShowByBranch)) ensure(k).noShow = v
  for (const b of Object.values(bd)) b.meetings = (b.arrived || 0) + (b.noShow || 0) + (b.scheduled || 0)
  for (const r of stageBranchR) {
    const b = ensure(bkey(r.k)); const st = r.st || ''
    b.opportunities += r.c
    if (st === STAGE_PAID) { b.paid = r.c; b.value = r0(r.v) }
    else if (st === STAGE_QUOTE) b.quotes = r.c
    else if (st === STAGE_LOST) b.lost = r.c
  }
  const brSm = {}
  const brSmGet = (b, n) => { brSm[b] = brSm[b] || {}; brSm[b][n] = brSm[b][n] || { name: n, leads: 0, meetings: 0, orders: 0, value: 0 }; return brSm[b][n] }
  for (const r of (smBrLeadsR || [])) brSmGet(bkey(r.k), r.n || 'לא ידוע').leads = r.c
  for (const r of (smBrMeetR || [])) brSmGet(bkey(r.k), r.n || 'לא ידוע').meetings = r.c
  for (const r of salesBranchR) {
    const o = brSmGet(bkey(r.k), r.n || 'לא ידוע')
    if (r.st === STAGE_PAID) { o.orders = r.c; o.value = r0(r.v) }
  }
  for (const [bk, obj] of Object.entries(brSm)) {
    ensure(bk).salesmen = Object.values(obj).map(o => ({ ...o, convToMeeting: _rate(o.meetings, o.leads), convToDeal: _rate(o.orders, o.leads), avgDeal: o.orders ? Math.round(o.value / o.orders) : 0 }))
  }
  for (const r of prodBranchR) ensure(bkey(r.k)).products.push({ name: r.n || 'לא ידוע', units: r.c, value: r0(r.v) })
  const branchDetail = Object.values(bd).map(b => {
    b.salesmen.sort((x, y) => y.value - x.value); b.salesmen = b.salesmen.slice(0, 10)
    b.products.sort((x, y) => y.units - x.units); b.products = b.products.slice(0, 8)
    b.quotesTotal = b.quotes + b.paid
    b.convLeadToMeeting = b.leads ? Math.round(b.meetings / b.leads * 1000) / 10 : 0
    b.convMeetingToOpp = b.meetings ? Math.round(b.opportunities / b.meetings * 1000) / 10 : 0
    b.convOppToPaid = b.opportunities ? Math.round(b.paid / b.opportunities * 1000) / 10 : 0
    b.convLeadToPaid = b.leads ? Math.round(b.paid / b.leads * 1000) / 10 : 0
    b.avgDeal = b.paid ? Math.round(b.value / b.paid) : 0
    b.topSalesman = b.salesmen[0] ? b.salesmen[0].name : null
    return b
  }).filter(b => b.leads > 0 || b.opportunities > 0).sort((a, b) => b.leads - a.leads)

  const OFF = israelOffsetHours(since)
  const meetingsByHour = {}
  for (const r of mtgHourR) {
    const local = ((Number(r.hr) + OFF) % 24 + 24) % 24
    meetingsByHour[local] = (meetingsByHour[local] || 0) + r.c
  }
  const meetingsByDay = {}
  for (const r of mtgDayR) meetingsByDay[DOW[(r.dw || 1) - 1] || r.dw] = r.c

  const conversionRate = totalLeads ? Math.round((paid / totalLeads) * 1000) / 10 : 0
  const avgDealValue = paid ? Math.round(dealValue / paid) : 0

  // xlsxRows for aggregateCrmRows compatibility (source-level)
  const xlsxRows = Object.entries(bySourceLeads).map(([source, c]) => ({
    source, totalLeads: c, relevantLeads: c, irrelevantLeads: 0,
    meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0,
    registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0,
  }))

  const summary = {
    crmType: 'salesforce',
    chain: CHAIN,
    totalLeads,
    convertedLeads,
    unconvertedLeads: totalLeads - convertedLeads,
    meetingsScheduled: meetingsTotal,
    relevantLeads: totalLeads,
    irrelevantLeads: 0,
    byStatus,
    bySource: bySourceLeads,
    byBranch: branches,
    reasons,
    competitors,
    buyingPurpose,
    products,
    salesmen,
    responseTime,
    branchDetail,
    meetingsByHour,
    meetingHourOffset: OFF,
    meetingsByDay,
    funnel: {
      leads: totalLeads,
      meetings: meetingsTotal,
      arrived: arrivedCnt,
      scheduledUpcoming: scheduledCnt,
      meetingsWithFutureDate: meetingLeads,
      noShow: noShowCnt,
      notInterested: lost,
      rateLeadToMeeting: totalLeads ? Math.round(meetingsTotal / totalLeads * 1000) / 10 : 0,
      rateMeetingToOpp: meetingsTotal ? Math.round(opportunities / meetingsTotal * 1000) / 10 : 0,
      rateOppToQuote: opportunities ? Math.round((quotes + paid) / opportunities * 1000) / 10 : 0,
      rateQuoteToPaid: (quotes + paid) ? Math.round(paid / (quotes + paid) * 1000) / 10 : 0,
      opportunities,
      quotes: quotesTotal,
      paid,
      lost,
      conversionRate,
      dealValue,
      deliveryValue,
      avgDealValue,
      byStage,
    },
    deals: { opportunities, closed: paid, closingRate: conversionRate, revenue: dealValue, avgDealValue },
    schemaVersion: SF_SCHEMA_VERSION,
  }

  const results = []
  for (const p of projectsList) {
    const { error: upErr } = await supabase.from('reports').upsert({
      project_id: p.id, source: 'crm', month: m,
      data: xlsxRows, summary, file_name: 'Salesforce CRM (live)', row_count: totalLeads,
    }, { onConflict: 'project_id,source,month' })
    if (upErr) results.push({ project: p.name, error: upErr.message })
    else results.push({ project: p.name, leads: totalLeads, opportunities, paid, ok: true })
  }
  return { status: 200, body: { ok: true, month: m, totalLeads, opportunities, quotes: quotesTotal, paid, dealValue, projects: results } }
}

// ===== handlers =====
function isValidDate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) }

export async function POST(request) {
  const anon = request.headers.get('x-client-key')
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || anon !== process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body = {}
  try { body = await request.json() } catch {}
  if ((body.since && !isValidDate(body.since)) || (body.until && !isValidDate(body.until))) {
    return Response.json({ error: 'invalid date format — use YYYY-MM-DD' }, { status: 400 })
  }
  try {
    const { status, body: rb } = await runSync({ month: body.month, since: body.since, until: body.until, projectId: body.projectId })
    return Response.json(rb, { status })
  } catch (e) {
    return Response.json({ error: 'runSync threw: ' + (e.message || String(e)) }, { status: 500 })
  }
}

export async function GET(request) {
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '')
  if (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) {
    const { status, body: rb } = await runSync()
    return Response.json(rb, { status })
  }
  return Response.json({ ok: true, configured: Boolean(process.env.SF_CLIENT_ID && process.env.SF_CLIENT_SECRET && process.env.SF_REFRESH_TOKEN) })
}
