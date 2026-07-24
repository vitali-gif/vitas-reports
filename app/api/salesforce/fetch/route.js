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
const SF_SCHEMA_VERSION = 10

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

  let totalLeads, convertedLeads, meetingLeads, meetingPeriodCnt, noShowPeriodCnt, byStatusR, byBranchR, bySourceR, reasonsR, competitorsR
  let oppStageR, oppBranchR, salesmenR, purposeR, productsR, lossReasonR, lossByBranchR, unqualByBranchR
  let cohortStagesR
  let noShowR, arrivedBranchR, schedBranchR, mtgBranchR, stageBranchR, salesBranchR, prodBranchR, mtgHourR, mtgDayR, branchCohortR
  try {
    ;[totalLeads, convertedLeads, meetingLeads, meetingPeriodCnt, noShowPeriodCnt] = await Promise.all([
      soqlCount(auth, `SELECT COUNT() FROM Lead WHERE ${LW}`),
      soqlCount(auth, `SELECT COUNT() FROM Lead WHERE ${LW} AND IsConverted=true`),
      soqlCount(auth, `SELECT COUNT() FROM Lead WHERE ${LW} AND meetingDate__c!=null`),
      soqlCount(auth, `SELECT COUNT() FROM Lead WHERE Chain_Name__c='${CHAIN}' AND meetingDate__c>=${FROM} AND meetingDate__c<=${TO}`),
      soqlCount(auth, `SELECT COUNT() FROM Lead WHERE Chain_Name__c='${CHAIN}' AND meetingDate__c>=${FROM} AND meetingDate__c<=${TO} AND Status='${STATUS_NOSHOW}'`),
    ])
    ;[byStatusR, byBranchR, bySourceR, reasonsR, competitorsR, cohortStagesR, unqualByBranchR] = await Promise.all([
      soql(auth, `SELECT Status k, COUNT(Id) c FROM Lead WHERE ${LW} GROUP BY Status`),
      soql(auth, `SELECT Branch_Name__c k, COUNT(Id) c FROM Lead WHERE ${LW} GROUP BY Branch_Name__c`),
      soql(auth, `SELECT LeadSource k, COUNT(Id) c FROM Lead WHERE ${LW} GROUP BY LeadSource`),
      soql(auth, `SELECT Unqualified_Reason__c k, COUNT(Id) c FROM Lead WHERE ${LW} AND Unqualified_Reason__c!=null GROUP BY Unqualified_Reason__c`),
      soql(auth, `SELECT Competitor_Name__c k, COUNT(Id) c FROM Lead WHERE ${LW} AND Competitor_Name__c!=null GROUP BY Competitor_Name__c`),
      soql(auth, `SELECT ConvertedOpportunity.StageName, ConvertedOpportunity.TotalPrice_Opp_Product__c FROM Lead WHERE ${LW} AND IsConverted=true`),
      soql(auth, `SELECT Branch_Name__c b, Unqualified_Reason__c k, COUNT(Id) c FROM Lead WHERE ${LW} AND Unqualified_Reason__c!=null GROUP BY Branch_Name__c, Unqualified_Reason__c`),
    ])
    ;[oppStageR, oppBranchR, salesmenR, purposeR, productsR, lossReasonR, lossByBranchR] = await Promise.all([
      soql(auth, `SELECT StageName k, COUNT(Id) c, SUM(TotalPrice_Opp_Product__c) v, SUM(ovala__c) o, SUM(Amount) am FROM Opportunity WHERE ${OW} GROUP BY StageName`),
      soql(auth, `SELECT Branch_Name__c k, COUNT(Id) c, SUM(TotalPrice_Opp_Product__c) v FROM Opportunity WHERE ${OW} GROUP BY Branch_Name__c`),
      soql(auth, `SELECT Salesman__r.Name k, StageName st, COUNT(Id) c, SUM(TotalPrice_Opp_Product__c) v FROM Opportunity WHERE ${OW} GROUP BY Salesman__r.Name, StageName`),
      soql(auth, `SELECT Buying_Purpose__c k, COUNT(Id) c FROM Opportunity WHERE ${OW} AND Buying_Purpose__c!=null GROUP BY Buying_Purpose__c`),
      soql(auth, `SELECT Product2.Name k, COUNT(Id) c, SUM(TotalPrice) v FROM OpportunityLineItem WHERE Opportunity.Cahin_Name__c='${CHAIN}' AND Opportunity.CreatedDate>=${FROM} AND Opportunity.CreatedDate<=${TO} GROUP BY Product2.Name`),
      soql(auth, `SELECT Loss_Reason__c k, COUNT(Id) c FROM Opportunity WHERE ${OW} AND Loss_Reason__c!=null GROUP BY Loss_Reason__c`),
      soql(auth, `SELECT Branch_Name__c b, Loss_Reason__c k, COUNT(Id) c FROM Opportunity WHERE ${OW} AND Loss_Reason__c!=null GROUP BY Branch_Name__c, Loss_Reason__c`),
    ])
    ;[noShowR, arrivedBranchR, schedBranchR, mtgBranchR, stageBranchR, salesBranchR, prodBranchR, mtgHourR, mtgDayR, branchCohortR] = await Promise.all([
      soql(auth, `SELECT Branch_Name__c k, COUNT(Id) c FROM Lead WHERE ${LW} AND Status='${STATUS_NOSHOW}' GROUP BY Branch_Name__c`),
      soql(auth, `SELECT Branch_Name__c k, COUNT(Id) c FROM Lead WHERE ${LW} AND Status IN (${STATUS_ARRIVED.map(x => `'${x}'`).join(',')}) GROUP BY Branch_Name__c`),
      soql(auth, `SELECT Branch_Name__c k, COUNT(Id) c FROM Lead WHERE ${LW} AND Status='${STATUS_SCHEDULED}' GROUP BY Branch_Name__c`),
      soql(auth, `SELECT Branch_Name__c k, COUNT(Id) c FROM Lead WHERE ${LW} AND meetingDate__c!=null GROUP BY Branch_Name__c`),
      soql(auth, `SELECT Branch_Name__c k, StageName st, COUNT(Id) c, SUM(TotalPrice_Opp_Product__c) v FROM Opportunity WHERE ${OW} GROUP BY Branch_Name__c, StageName`),
      soql(auth, `SELECT Branch_Name__c k, Salesman__r.Name n, StageName st, COUNT(Id) c, SUM(TotalPrice_Opp_Product__c) v FROM Opportunity WHERE ${OW} GROUP BY Branch_Name__c, Salesman__r.Name, StageName`),
      soql(auth, `SELECT Opportunity.Branch_Name__c k, Product2.Name n, COUNT(Id) c, SUM(TotalPrice) v FROM OpportunityLineItem WHERE Opportunity.Cahin_Name__c='${CHAIN}' AND Opportunity.CreatedDate>=${FROM} AND Opportunity.CreatedDate<=${TO} GROUP BY Opportunity.Branch_Name__c, Product2.Name`),
      soql(auth, `SELECT HOUR_IN_DAY(meetingDate__c) hr, COUNT(Id) c FROM Lead WHERE ${LW} AND meetingDate__c!=null GROUP BY HOUR_IN_DAY(meetingDate__c)`),
      soql(auth, `SELECT DAY_IN_WEEK(meetingDate__c) dw, COUNT(Id) c FROM Lead WHERE ${LW} AND meetingDate__c!=null GROUP BY DAY_IN_WEEK(meetingDate__c)`),
      soql(auth, `SELECT Branch_Name__c, ConvertedOpportunity.StageName, ConvertedOpportunity.TotalPrice_Opp_Product__c FROM Lead WHERE ${LW} AND IsConverted=true`),
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
  // Salesman metrics are OPPORTUNITY-based only. On a Lead the "Salesman__c" field holds the
  // BRANCH MANAGER (auto-assigned on lead creation), not the real rep — so lead counts are
  // meaningless per rep. The actual rep is set when the Opportunity is opened.
  const smAgg = {}
  const smGet = (n) => (smAgg[n] = smAgg[n] || { name: n, opportunities: 0, quotes: 0, quotesValue: 0, orders: 0, value: 0 })
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
    convToDeal: _rate(o.orders, o.opportunities),
  })).filter(o => o.opportunities > 0).sort((a, b) => b.value - a.value)

  const products = productsR.map(r => ({ name: r.k || 'לא ידוע', units: r.c, value: r0(r.v) }))
    .sort((a, b) => b.units - a.units)

  const LOSS_MAP = { 'Lost to Competitor': 'מתחרה', 'No Decision / Non-Responsive': 'אין החלטה / לא מגיב', 'Price': 'מחיר', 'Other': 'אחר' }
  const UNQ_MAP = { 'Expensive': 'יקר מדי', 'Competitor': 'מתחרה', 'Other': 'אחר' }
  // Opportunity-level: closed-lost reasons (aggregated bars)
  const lossReasons = (lossReasonR || []).map(r => ({ reason: LOSS_MAP[r.k] || r.k || 'לא ידוע', count: r.c })).sort((a, b) => b.count - a.count)
  const lossTotal = lossReasons.reduce((s2, r) => s2 + r.count, 0)
  // Lead-level: unqualified reasons (aggregated bars)
  const unqualReasons = (reasonsR || []).map(r => ({ reason: UNQ_MAP[r.k] || r.k || 'לא ידוע', count: r.c })).sort((a, b) => b.count - a.count)
  const unqualTotal = unqualReasons.reduce((s2, r) => s2 + r.count, 0)
  const _byBranchReasons = (rows, MAP) => {
    const m = {}
    for (const r of (rows || [])) {
      const b = (r.b === null || r.b === undefined || r.b === '') ? 'לא ידוע' : r.b
      ;(m[b] = m[b] || []).push({ reason: MAP[r.k] || r.k || 'לא ידוע', count: r.c })
    }
    for (const b of Object.keys(m)) m[b].sort((x, y) => y.count - x.count)
    return m
  }
  const lossReasonsByBranch = _byBranchReasons(lossByBranchR, LOSS_MAP)
  const unqualReasonsByBranch = _byBranchReasons(unqualByBranchR, UNQ_MAP)
  // "Other" free-text individual notes (lead + opportunity) — best-effort, never breaks the base fetch
  let otherLossNotes = [], otherUnqualNotes = [], objNotesErr = null
  try {
    const [oppNotesR, leadNotesR] = await Promise.all([
      soql(auth, `SELECT Id, Name, Mobile__c, Branch_Name__c, Salesman__r.Name, StageName, TotalPrice_Opp_Product__c, CreatedDate, Loss_Reason__c, Other_Loss_Reason__c FROM Opportunity WHERE ${OW} AND Other_Loss_Reason__c!=null ORDER BY CreatedDate DESC LIMIT 200`),
      soql(auth, `SELECT Id, Name, Phone, MobilePhone, Email, Branch_Name__c, Salesman__r.Name, Status, LeadSource, CreatedDate, Unqualified_Reason__c, Other_Unqualified_Reason__c FROM Lead WHERE ${LW} AND Other_Unqualified_Reason__c!=null ORDER BY CreatedDate DESC LIMIT 200`),
    ])
    otherLossNotes = (oppNotesR || []).map(r => ({
      text: r.Other_Loss_Reason__c || '',
      reason: LOSS_MAP[r.Loss_Reason__c] || r.Loss_Reason__c || '',
      name: r.Name || '',
      contactName: '',
      phone: r.Mobile__c || '',
      email: '',
      branch: r.Branch_Name__c || '',
      salesman: (r.Salesman__r && r.Salesman__r.Name) || '',
      stage: r.StageName || '',
      value: r0(num(r.TotalPrice_Opp_Product__c)),
      date: r.CreatedDate ? String(r.CreatedDate).slice(0, 10) : '',
    }))
    otherUnqualNotes = (leadNotesR || []).map(r => ({
      text: r.Other_Unqualified_Reason__c || '',
      reason: UNQ_MAP[r.Unqualified_Reason__c] || r.Unqualified_Reason__c || '',
      name: r.Name || '',
      phone: r.MobilePhone || r.Phone || '',
      email: r.Email || '',
      branch: r.Branch_Name__c || '',
      salesman: (r.Salesman__r && r.Salesman__r.Name) || '',
      status: r.Status || '',
      source: r.LeadSource || '',
      date: r.CreatedDate ? String(r.CreatedDate).slice(0, 10) : '',
    }))
  } catch (e) { objNotesErr = e.message }

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
  // per-branch COHORT (this month's leads -> their converted opportunity)
  for (const r of (branchCohortR || [])) {
    const b = ensure(bkey(r.Branch_Name__c))
    const o = r.ConvertedOpportunity; if (!o) continue
    const st = o.StageName || ''
    b.cohortOpps = (b.cohortOpps || 0) + 1
    if (st === STAGE_PAID) { b.cohortPaid = (b.cohortPaid || 0) + 1; b.cohortValue = (b.cohortValue || 0) + num(o.TotalPrice_Opp_Product__c) }
    else if (st === STAGE_QUOTE) { b.cohortQuote = (b.cohortQuote || 0) + 1; b.cohortQuoteValue = (b.cohortQuoteValue || 0) + num(o.TotalPrice_Opp_Product__c) }
    else if (st === STAGE_LOST) { b.cohortLost = (b.cohortLost || 0) + 1 }
  }
  // COHORT drill-down (salesmen + products) — best-effort, never breaks the base fetch
  let cohortDrillErr = null
  try {
    const [cohortSmR, cohortProdR] = await Promise.all([
      soql(auth, `SELECT Branch_Name__c, ConvertedOpportunity.StageName, ConvertedOpportunity.TotalPrice_Opp_Product__c, ConvertedOpportunity.Salesman__r.Name FROM Lead WHERE ${LW} AND IsConverted=true`),
      soql(auth, `SELECT Opportunity.Branch_Name__c k, Product2.Name n, COUNT(Id) c, SUM(TotalPrice) v FROM OpportunityLineItem WHERE OpportunityId IN (SELECT ConvertedOpportunityId FROM Lead WHERE ${LW} AND IsConverted=true) GROUP BY Opportunity.Branch_Name__c, Product2.Name`),
    ])
    const brSmC = {}
    const brSmCGet = (b, n) => { brSmC[b] = brSmC[b] || {}; brSmC[b][n] = brSmC[b][n] || { name: n, opportunities: 0, quotes: 0, quotesValue: 0, orders: 0, value: 0 }; return brSmC[b][n] }
    for (const r of (cohortSmR || [])) {
      const o = r.ConvertedOpportunity; if (!o) continue
      const st = o.StageName || ''
      const sname = (o.Salesman__r && o.Salesman__r.Name) || 'לא ידוע'
      const so = brSmCGet(bkey(r.Branch_Name__c), sname)
      so.opportunities += 1
      if (st === STAGE_PAID) { so.orders += 1; so.value += num(o.TotalPrice_Opp_Product__c) }
      else if (st === STAGE_QUOTE) { so.quotes += 1; so.quotesValue += num(o.TotalPrice_Opp_Product__c) }
    }
    for (const [bk, obj] of Object.entries(brSmC)) {
      ensure(bk).cohortSalesmen = Object.values(obj).map(o => ({ ...o, quotesTotal: o.quotes + o.orders, quotesValueTotal: o.quotesValue + o.value, convToDeal: _rate(o.orders, o.opportunities), avgDeal: o.orders ? Math.round(o.value / o.orders) : 0 }))
    }
    for (const r of (cohortProdR || [])) { const b = ensure(bkey(r.k)); (b.cohortProducts = b.cohortProducts || []).push({ name: r.n || 'לא ידוע', units: r.c, value: r0(r.v) }) }
  } catch (e) { cohortDrillErr = e.message }
  const brSm = {}
  const brSmGet = (b, n) => { brSm[b] = brSm[b] || {}; brSm[b][n] = brSm[b][n] || { name: n, opportunities: 0, quotes: 0, quotesValue: 0, orders: 0, value: 0 }; return brSm[b][n] }
  for (const r of salesBranchR) {
    const o = brSmGet(bkey(r.k), r.n || 'לא ידוע')
    o.opportunities += r.c
    if (r.st === STAGE_PAID) { o.orders = r.c; o.value = r0(r.v) }
    else if (r.st === STAGE_QUOTE) { o.quotes = r.c; o.quotesValue = r0(r.v) }
  }
  for (const [bk, obj] of Object.entries(brSm)) {
    ensure(bk).salesmen = Object.values(obj).map(o => ({ ...o, quotesTotal: o.quotes + o.orders, quotesValueTotal: o.quotesValue + o.value, convToDeal: _rate(o.orders, o.opportunities), avgDeal: o.orders ? Math.round(o.value / o.orders) : 0 }))
  }
  for (const r of prodBranchR) ensure(bkey(r.k)).products.push({ name: r.n || 'לא ידוע', units: r.c, value: r0(r.v) })
  const branchDetail = Object.values(bd).map(b => {
    b.salesmen = b.salesmen.filter(x => x.opportunities > 0).sort((x, y) => y.value - x.value).slice(0, 10)
    b.products.sort((x, y) => y.units - x.units); b.products = b.products.slice(0, 8)
    b.quotesTotal = b.quotes + b.paid
    b.value = r0(b.value)
    b.cohortOpps = b.cohortOpps || 0
    b.cohortQuotesTotal = (b.cohortQuote || 0) + (b.cohortPaid || 0)
    b.cohortQuotesValue = r0(b.cohortQuoteValue)
    b.cohortPaid = b.cohortPaid || 0
    b.cohortValue = r0(b.cohortValue)
    b.cohortLost = b.cohortLost || 0
    b.cohortConvLeadToPaid = b.leads ? Math.round(b.cohortPaid / b.leads * 1000) / 10 : 0
    b.cohortAvgDeal = b.cohortPaid ? Math.round(b.cohortValue / b.cohortPaid) : 0
    b.cohortSalesmen = (b.cohortSalesmen || []).filter(x => x.opportunities > 0).sort((x, y) => y.value - x.value).slice(0, 10)
    b.cohortProducts = (b.cohortProducts || []).sort((x, y) => y.units - x.units).slice(0, 8)
    b.cohortTopSalesman = b.cohortSalesmen[0] ? b.cohortSalesmen[0].name : null
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

  // ===== two lenses =====
  const _cc = {}, _cv = {}
  for (const r of (cohortStagesR || [])) {
    const o = r.ConvertedOpportunity; if (!o) continue
    const st = o.StageName || 'none'
    _cc[st] = (_cc[st] || 0) + 1
    _cv[st] = (_cv[st] || 0) + num(o.TotalPrice_Opp_Product__c)
  }
  const cohortPaid = _cc[STAGE_PAID] || 0
  const cohortQuote = _cc[STAGE_QUOTE] || 0
  const cohortLost = _cc[STAGE_LOST] || 0
  const cohortNew = _cc['חדש'] || 0
  const cohortOpps = cohortPaid + cohortQuote + cohortLost + cohortNew
  const cohortPaidValue = r0(_cv[STAGE_PAID])
  const cohortQuoteValue = r0(_cv[STAGE_QUOTE])
  const _r1 = (a, b) => b > 0 ? Math.round(a / b * 1000) / 10 : 0
  // Cohort funnel — this month's leads, strictly nested
  const funnelCohort = {
    leads: totalLeads,
    meetings: meetingsTotal,
    arrived: arrivedCnt,
    opportunities: cohortOpps,
    quotes: cohortQuote + cohortPaid,
    quotesValue: cohortQuoteValue,
    noShow: noShowCnt,
    paid: cohortPaid,
    paidValue: cohortPaidValue,
    lost: cohortLost,
    untreated: cohortNew,
    rateLeadToMeeting: _r1(meetingsTotal, totalLeads),
    rateMeetingToArrived: _r1(arrivedCnt, meetingsTotal),
    rateArrivedToOpp: _r1(cohortOpps, arrivedCnt),
    rateOppToQuote: _r1(cohortQuote + cohortPaid, cohortOpps),
    rateQuoteToPaid: _r1(cohortPaid, cohortQuote + cohortPaid),
    rateLeadToPaid: _r1(cohortPaid, totalLeads),
  }
  // Period report — everything created/held this month (incl. earlier leads)
  const funnelPeriod = {
    leads: totalLeads,
    meetings: meetingPeriodCnt || 0,
    noShow: noShowPeriodCnt || 0,
    opportunities,
    quotes: quotes + paid,
    quotesValue: r0((byStage[STAGE_QUOTE] || {}).value),
    paid,
    paidValue: dealValue,
    dealValue,
    lost,
    rateLeadToPaid: _r1(paid, totalLeads),
  }
  const conversionRate = totalLeads ? Math.round((paid / totalLeads) * 1000) / 10 : 0
  const avgDealValue = paid ? Math.round(dealValue / paid) : 0

  // xlsxRows for aggregateCrmRows compatibility (source-level)
  const xlsxRows = Object.entries(bySourceLeads).map(([source, c]) => ({
    source, totalLeads: c, relevantLeads: c, irrelevantLeads: 0,
    meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0,
    registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0,
  }))

  // ===== time from "קיבל הצעת מחיר" -> "הזמנה - שולמה מקדמה" (OpportunityHistory) =====
  let quoteToDeposit = { avgDays: 0, medianDays: 0, measured: 0 }, quoteToDepositByBranch = {}, q2dErr = null
  try {
    const hist = await soql(auth,
      `SELECT OpportunityId, Opportunity.Branch_Name__c, StageName, CreatedDate FROM OpportunityHistory WHERE Opportunity.Cahin_Name__c='${CHAIN}' AND Opportunity.CreatedDate>=${FROM} AND Opportunity.CreatedDate<=${TO} AND StageName IN ('${STAGE_QUOTE}','${STAGE_PAID}') ORDER BY OpportunityId, CreatedDate`, 12)
    const perOpp = {}
    for (const r of (hist || [])) {
      const id = r.OpportunityId
      const br = bkey(r.Opportunity && r.Opportunity.Branch_Name__c)
      const p = perOpp[id] || (perOpp[id] = { branch: br, quote: null, paid: null })
      const t = new Date(r.CreatedDate).getTime()
      if (r.StageName === STAGE_QUOTE) { if (p.quote === null || t < p.quote) p.quote = t }
      else if (r.StageName === STAGE_PAID) { if (p.paid === null || t < p.paid) p.paid = t }
    }
    const stat = (arr) => { if (!arr.length) return { avgDays: 0, medianDays: 0, measured: 0 }; const so = arr.slice().sort((a, b) => a - b); return { avgDays: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10, medianDays: Math.round(so[Math.floor(so.length / 2)] * 10) / 10, measured: arr.length } }
    const all = [], byBr = {}
    for (const o of Object.values(perOpp)) {
      if (o.quote !== null && o.paid !== null && o.paid >= o.quote) {
        const days = (o.paid - o.quote) / 86400000
        all.push(days)
        ;(byBr[o.branch] = byBr[o.branch] || []).push(days)
      }
    }
    quoteToDeposit = stat(all)
    for (const [b, arr] of Object.entries(byBr)) quoteToDepositByBranch[b] = stat(arr)
  } catch (e) { q2dErr = e.message }

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
    funnelCohort,
    funnelPeriod,
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
    lossReasons,
    lossTotal,
    otherLossNotes,
    unqualReasons,
    unqualTotal,
    otherUnqualNotes,
    lossReasonsByBranch,
    unqualReasonsByBranch,
    quoteToDeposit,
    quoteToDepositByBranch,
    _objNotesErr: objNotesErr,
    _q2dErr: q2dErr,
    schemaVersion: SF_SCHEMA_VERSION,
    _cohortDrillErr: cohortDrillErr,
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
  const { searchParams } = new URL(request.url)
  if (searchParams.get('leadtopay3')) {
    try {
      const a = await getAuth()
      const qy = async (q) => { let url = `${a.instance}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(q)}`; let rows = []; for (let i = 0; i < 25 && url; i++) { const r = await fetch(url, { headers: { Authorization: `Bearer ${a.token}` } }); const j = await r.json(); if (j.records) rows = rows.concat(j.records); url = j.nextRecordsUrl ? `${a.instance}${j.nextRecordsUrl}` : null } return rows }
      const norm = (p) => { if (!p) return null; let d = String(p).replace(/[^0-9]/g, ''); if (d.startsWith('972')) d = '0' + d.slice(3); if (d.length === 9) d = '0' + d; return d.length >= 9 ? d.slice(-10) : null }
      const paidRows = await qy(`SELECT OpportunityId, CreatedDate FROM OpportunityHistory WHERE Opportunity.Cahin_Name__c='קלוס' AND StageName='הזמנה - שולמה מקדמה' AND CreatedDate>=2026-07-01T00:00:00Z AND CreatedDate<=2026-07-31T23:59:59Z ORDER BY OpportunityId, CreatedDate`)
      const paidTime = {}
      for (const r of paidRows) { const t = new Date(r.CreatedDate).getTime(); if (paidTime[r.OpportunityId] == null || t < paidTime[r.OpportunityId]) paidTime[r.OpportunityId] = t }
      const oppIds = Object.keys(paidTime)
      const oppPhone = {}; const rawPhones = new Set()
      for (let i = 0; i < oppIds.length; i += 200) {
        const inList = oppIds.slice(i, i + 200).map(x => `'${x}'`).join(',')
        const orr = await qy(`SELECT Id, Mobile__c FROM Opportunity WHERE Id IN (${inList})`)
        for (const r of orr) if (r.Mobile__c) { oppPhone[r.Id] = norm(r.Mobile__c); rawPhones.add(String(r.Mobile__c)) }
      }
      const rawArr = [...rawPhones]
      const leadByPhone = {}
      for (let i = 0; i < rawArr.length; i += 150) {
        const inList = rawArr.slice(i, i + 150).map(x => `'${x.replace(/'/g, "")}'`).join(',')
        const lr = await qy(`SELECT Phone, MobilePhone, CreatedDate FROM Lead WHERE Chain_Name__c='קלוס' AND (MobilePhone IN (${inList}) OR Phone IN (${inList}))`)
        for (const r of lr) { const t = new Date(r.CreatedDate).getTime(); for (const ph of [norm(r.MobilePhone), norm(r.Phone)]) if (ph) { if (leadByPhone[ph] == null || t < leadByPhone[ph]) leadByPhone[ph] = t } }
      }
      const days = [], buckets = { d0: 0, d1_7: 0, d8_14: 0, d15_30: 0, d31_60: 0, d60plus: 0, negative: 0 }, samples = []
      let withPhone = 0
      for (const id of oppIds) {
        const ph = oppPhone[id]; if (ph) withPhone++
        const lc = ph ? leadByPhone[ph] : null; if (lc == null) continue
        const d = (paidTime[id] - lc) / 86400000; days.push(d)
        if (d < 0) buckets.negative++; else if (d < 1) buckets.d0++; else if (d <= 7) buckets.d1_7++; else if (d <= 14) buckets.d8_14++; else if (d <= 30) buckets.d15_30++; else if (d <= 60) buckets.d31_60++; else buckets.d60plus++
        if (samples.length < 12) samples.push({ leadCreated: new Date(lc).toISOString().slice(0, 10), paid: new Date(paidTime[id]).toISOString().slice(0, 10), days: Math.round(d * 10) / 10 })
      }
      days.sort((a, b) => a - b)
      const avg = days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length * 10) / 10 : 0
      const median = days.length ? Math.round(days[Math.floor(days.length / 2)] * 10) / 10 : 0
      return Response.json({ julyDeposits: oppIds.length, oppWithPhone: withPhone, matchedToLead: days.length, avgDays: avg, medianDays: median, buckets, samples })
    } catch (e) { return Response.json({ error: e.message }, { status: 500 }) }
  }
  if (searchParams.get('leadtopay2')) {
    try {
      const a = await getAuth()
      const qy = async (q) => { let url = `${a.instance}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(q)}`; let rows = []; for (let i = 0; i < 25 && url; i++) { const r = await fetch(url, { headers: { Authorization: `Bearer ${a.token}` } }); const j = await r.json(); if (j.records) rows = rows.concat(j.records); url = j.nextRecordsUrl ? `${a.instance}${j.nextRecordsUrl}` : null } return rows }
      const paidRows = await qy(`SELECT OpportunityId, CreatedDate FROM OpportunityHistory WHERE Opportunity.Cahin_Name__c='קלוס' AND StageName='הזמנה - שולמה מקדמה' AND CreatedDate>=2026-07-01T00:00:00Z AND CreatedDate<=2026-07-31T23:59:59Z ORDER BY OpportunityId, CreatedDate`)
      const paidTime = {}
      for (const r of paidRows) { const t = new Date(r.CreatedDate).getTime(); if (paidTime[r.OpportunityId] == null || t < paidTime[r.OpportunityId]) paidTime[r.OpportunityId] = t }
      const oppIds = Object.keys(paidTime)
      // opp -> contactId
      const oppContact = {}
      for (let i = 0; i < oppIds.length; i += 200) {
        const inList = oppIds.slice(i, i + 200).map(x => `'${x}'`).join(',')
        const orr = await qy(`SELECT Id, ContactId FROM Opportunity WHERE Id IN (${inList})`)
        for (const r of orr) if (r.ContactId) oppContact[r.Id] = r.ContactId
      }
      const contactIds = [...new Set(Object.values(oppContact))]
      // contactId -> min lead CreatedDate (via ConvertedContactId)
      const contactLead = {}
      for (let i = 0; i < contactIds.length; i += 200) {
        const inList = contactIds.slice(i, i + 200).map(x => `'${x}'`).join(',')
        const lr = await qy(`SELECT ConvertedContactId, CreatedDate FROM Lead WHERE Chain_Name__c='קלוס' AND ConvertedContactId IN (${inList})`)
        for (const r of lr) { const t = new Date(r.CreatedDate).getTime(); if (contactLead[r.ConvertedContactId] == null || t < contactLead[r.ConvertedContactId]) contactLead[r.ConvertedContactId] = t }
      }
      const days = [], buckets = { d0: 0, d1_7: 0, d8_14: 0, d15_30: 0, d31_60: 0, d60plus: 0, negative: 0 }, samples = []
      let withContact = 0
      for (const id of oppIds) {
        const cid = oppContact[id]; if (cid) withContact++
        const lc = cid ? contactLead[cid] : null; if (lc == null) continue
        const d = (paidTime[id] - lc) / 86400000; days.push(d)
        if (d < 0) buckets.negative++; else if (d < 1) buckets.d0++; else if (d <= 7) buckets.d1_7++; else if (d <= 14) buckets.d8_14++; else if (d <= 30) buckets.d15_30++; else if (d <= 60) buckets.d31_60++; else buckets.d60plus++
        if (samples.length < 12) samples.push({ leadCreated: new Date(lc).toISOString().slice(0, 10), paid: new Date(paidTime[id]).toISOString().slice(0, 10), days: Math.round(d * 10) / 10 })
      }
      days.sort((a, b) => a - b)
      const avg = days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length * 10) / 10 : 0
      const median = days.length ? Math.round(days[Math.floor(days.length / 2)] * 10) / 10 : 0
      return Response.json({ julyDeposits: oppIds.length, oppWithContact: withContact, matchedToLead: days.length, avgDays: avg, medianDays: median, buckets, samples })
    } catch (e) { return Response.json({ error: e.message }, { status: 500 }) }
  }
  if (searchParams.get('leadtopay')) {
    try {
      const a = await getAuth()
      const qy = async (q) => { let url = `${a.instance}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(q)}`; let rows = []; for (let i = 0; i < 25 && url; i++) { const r = await fetch(url, { headers: { Authorization: `Bearer ${a.token}` } }); const j = await r.json(); if (j.records) rows = rows.concat(j.records); url = j.nextRecordsUrl ? `${a.instance}${j.nextRecordsUrl}` : null } return rows }
      const paidRows = await qy(`SELECT OpportunityId, CreatedDate FROM OpportunityHistory WHERE Opportunity.Cahin_Name__c='קלוס' AND StageName='הזמנה - שולמה מקדמה' AND CreatedDate>=2026-07-01T00:00:00Z AND CreatedDate<=2026-07-31T23:59:59Z ORDER BY OpportunityId, CreatedDate`)
      const paidTime = {}
      for (const r of paidRows) { const t = new Date(r.CreatedDate).getTime(); if (paidTime[r.OpportunityId] == null || t < paidTime[r.OpportunityId]) paidTime[r.OpportunityId] = t }
      const oppIds = Object.keys(paidTime)
      const leadCreated = {}
      for (let i = 0; i < oppIds.length; i += 200) {
        const inList = oppIds.slice(i, i + 200).map(x => `'${x}'`).join(',')
        const lr = await qy(`SELECT ConvertedOpportunityId, CreatedDate FROM Lead WHERE Chain_Name__c='קלוס' AND ConvertedOpportunityId IN (${inList})`)
        for (const r of lr) { const t = new Date(r.CreatedDate).getTime(); if (leadCreated[r.ConvertedOpportunityId] == null || t < leadCreated[r.ConvertedOpportunityId]) leadCreated[r.ConvertedOpportunityId] = t }
      }
      const days = [], buckets = { d0: 0, d1_7: 0, d8_14: 0, d15_30: 0, d31_60: 0, d60plus: 0, negative: 0 }, samples = []
      for (const id of oppIds) { if (leadCreated[id] == null) continue; const d = (paidTime[id] - leadCreated[id]) / 86400000; days.push(d); if (d < 0) buckets.negative++; else if (d < 1) buckets.d0++; else if (d <= 7) buckets.d1_7++; else if (d <= 14) buckets.d8_14++; else if (d <= 30) buckets.d15_30++; else if (d <= 60) buckets.d31_60++; else buckets.d60plus++; if (samples.length < 12) samples.push({ leadCreated: new Date(leadCreated[id]).toISOString().slice(0, 10), paid: new Date(paidTime[id]).toISOString().slice(0, 10), days: Math.round(d * 10) / 10 }) }
      days.sort((a, b) => a - b)
      const avg = days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length * 10) / 10 : 0
      const median = days.length ? Math.round(days[Math.floor(days.length / 2)] * 10) / 10 : 0
      return Response.json({ julyDeposits: oppIds.length, matchedToLead: days.length, avgDays: avg, medianDays: median, buckets, samples })
    } catch (e) { return Response.json({ error: e.message }, { status: 500 }) }
  }
  if (searchParams.get('q2ddebug')) {
    try {
      const a = await getAuth()
      const q = `SELECT OpportunityId, StageName, CreatedDate FROM OpportunityHistory WHERE Opportunity.Cahin_Name__c='קלוס' AND Opportunity.CreatedDate>=2026-07-01T00:00:00Z AND StageName IN ('קיבל הצעת מחיר','הזמנה - שולמה מקדמה') ORDER BY OpportunityId, CreatedDate`
      let url = `${a.instance}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(q)}`
      let rows = []
      for (let i = 0; i < 15 && url; i++) { const r = await fetch(url, { headers: { Authorization: `Bearer ${a.token}` } }); const j = await r.json(); rows = rows.concat(j.records || []); url = j.nextRecordsUrl ? `${a.instance}${j.nextRecordsUrl}` : null }
      const per = {}
      for (const r of rows) { const p = per[r.OpportunityId] || (per[r.OpportunityId] = { q: null, p: null }); const t = new Date(r.CreatedDate).getTime(); if (r.StageName === 'קיבל הצעת מחיר') { if (p.q === null || t < p.q) p.q = t } else { if (p.p === null || t < p.p) p.p = t } }
      const buckets = { same0: 0, d1_3: 0, d4_10: 0, d11_30: 0, d30plus: 0, negative: 0 }
      const samples = []
      const days = []
      for (const [id, o] of Object.entries(per)) {
        if (o.q === null || o.p === null) continue
        const d = (o.p - o.q) / 86400000
        days.push(d)
        if (d < 0) buckets.negative++; else if (d < 1) buckets.same0++; else if (d <= 3) buckets.d1_3++; else if (d <= 10) buckets.d4_10++; else if (d <= 30) buckets.d11_30++; else buckets.d30plus++
        if (samples.length < 10) samples.push({ id, quote: new Date(o.q).toISOString(), paid: new Date(o.p).toISOString(), days: Math.round(d * 100) / 100 })
      }
      const bothCount = days.length
      const oppWithQuote = Object.values(per).filter(o => o.q !== null).length
      const oppWithPaid = Object.values(per).filter(o => o.p !== null).length
      return Response.json({ historyRows: rows.length, distinctOpps: Object.keys(per).length, oppWithQuote, oppWithPaid, measuredBoth: bothCount, buckets, samples })
    } catch (e) { return Response.json({ error: e.message }, { status: 500 }) }
  }
  if (searchParams.get('probe')) {
    try {
      const a = await getAuth()
      const cnt = async (q) => { const r = await fetch(`${a.instance}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${a.token}` } }); const j = await r.json(); return j.totalSize }
      const out = {
        oppOtherLoss_all: await cnt(`SELECT COUNT() FROM Opportunity WHERE Cahin_Name__c='קלוס' AND Other_Loss_Reason__c!=null`),
        leadOtherUnqual_all: await cnt(`SELECT COUNT() FROM Lead WHERE Chain_Name__c='קלוס' AND Other_Unqualified_Reason__c!=null`),
        leadUnqual_all: await cnt(`SELECT COUNT() FROM Lead WHERE Chain_Name__c='קלוס' AND Unqualified_Reason__c!=null`),
        oppHist_quoteOrPaid_2026_07: await cnt(`SELECT COUNT() FROM OpportunityHistory WHERE Opportunity.Cahin_Name__c='קלוס' AND Opportunity.CreatedDate>=2026-07-01T00:00:00Z AND StageName IN ('קיבל הצעת מחיר','הזמנה - שולמה מקדמה')`),
      }
      return Response.json(out)
    } catch (e) { return Response.json({ error: e.message }, { status: 500 }) }
  }
  if (searchParams.get('describe')) {
    try {
      const a = await getAuth()
      const obj = searchParams.get('describe') === '1' ? 'Opportunity' : searchParams.get('describe')
      const r = await fetch(`${a.instance}/services/data/${SF_API_VERSION}/sobjects/${obj}/describe`, { headers: { Authorization: `Bearer ${a.token}` } })
      const j = await r.json()
      const term = searchParams.get('find') || ''
      const fields = (j.fields || [])
        .filter(fl => !term || (fl.label && fl.label.includes(term)) || (fl.name && fl.name.toLowerCase().includes(term.toLowerCase())))
        .map(fl => ({ name: fl.name, label: fl.label, type: fl.type, picklist: (fl.picklistValues || []).map(p => p.value).slice(0, 40) }))
      return Response.json({ object: obj, count: fields.length, fields })
    } catch (e) { return Response.json({ error: e.message }, { status: 500 }) }
  }
  return Response.json({ ok: true, configured: Boolean(process.env.SF_CLIENT_ID && process.env.SF_CLIENT_SECRET && process.env.SF_REFRESH_TOKEN) })
}
