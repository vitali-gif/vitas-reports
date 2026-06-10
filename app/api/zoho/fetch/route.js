// API route: /api/zoho/fetch
//   POST — from the admin UI (auth via x-client-key header = anon key)
//   GET  — from Vercel Cron (auth via Authorization: Bearer <CRON_SECRET>)
//
// Pulls BCureLaser leads + deals from Zoho CRM, writes to Supabase.
//
// Definitions (verified against the Zoho Analytics report, 2026-06-05):
//   Leads        = segment=bcurelaser AND Lead_Source=דיגיטל AND
//                  Sub_Lead_Source ∈ {facebook, google, אתר חברה, וואטסאפ},
//                  created in the period. MUST include converted leads (converted=both),
//                  otherwise Zoho returns only non-converted leads (~half are missed).
//   Opportunities (Id Count)        = leads that have a linked deal (deal.LidID = lead.id).
//   Purchased    (Closing Date Cnt) = linked deals that have a Closing_Date set.
//   Closing rate (אחוז המרה)        = purchased / leads.
//
// Env vars required:
//   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN
//   ZOHO_API_DOMAIN  (default: https://www.zohoapis.com)

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ZOHO_TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token'
const ZOHO_SCHEMA_VERSION = 2

// BCureLaser: only count these digital sub-sources
const DIGITAL_SUBSOURCES = new Set([
  'facebook', 'google', 'אתר חברה', 'וואטסאפ', 'whatsapp',
  'גוגל', 'פייסבוק', // Hebrew variants
])

// ===== helpers =====

function currentMonth() {
  const now = new Date()
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
}

function num(v) {
  if (typeof v === 'number') return v
  if (!v) return 0
  const n = parseFloat(String(v))
  return isNaN(n) ? 0 : n
}

// ===== Zoho OAuth =====

async function getZohoAccessToken() {
  const params = new URLSearchParams({
    client_id:     process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    grant_type:    'refresh_token',
  })
  const res = await fetch(ZOHO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Zoho token refresh failed ${res.status}: ${txt.slice(0, 300)}`)
  }
  const json = await res.json()
  if (json.error) throw new Error(`Zoho OAuth error: ${json.error}`)
  return json.access_token
}

// ===== Zoho API =====

const ZOHO_API_DOMAIN = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com'

async function zohoFetch(accessToken, url) {
  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  })
  if (res.status === 204) return { data: [], info: {} }
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Zoho GET ${res.status}: ${txt.slice(0, 400)}`)
  }
  return res.json()
}

// Search a module by criteria (page-based pagination).
// `converted` is 'both' | 'true' | 'false' (Leads only) — needed to include converted leads.
async function searchPaginated(accessToken, module, criteria, fields, converted = null, maxPages = 20) {
  const out = []
  let page = 1
  while (page <= maxPages) {
    const params = new URLSearchParams({ criteria, fields, per_page: '200', page: String(page) })
    if (converted) params.set('converted', converted)
    const url = `${ZOHO_API_DOMAIN}/crm/v3/${module}/search?${params.toString()}`
    const json = await zohoFetch(accessToken, url)
    const recs = json.data || []
    out.push(...recs)
    if (json.info && json.info.more_records) page++
    else break
  }
  return out
}

// Fetch all deals linked to the given lead ids (deal.LidID = lead.id), chunked by criteria length.
async function fetchDealsByLeadIds(accessToken, leadIds, fields, chunkSize = 15) {
  const byId = {}
  for (let i = 0; i < leadIds.length; i += chunkSize) {
    const chunk = leadIds.slice(i, i + chunkSize)
    const criteria = '(' + chunk.map(id => `(LidID:equals:${id})`).join('or') + ')'
    let page = 1
    while (page <= 5) {
      const params = new URLSearchParams({ criteria, fields, per_page: '200', page: String(page) })
      const url = `${ZOHO_API_DOMAIN}/crm/v3/Deals/search?${params.toString()}`
      const json = await zohoFetch(accessToken, url)
      for (const d of (json.data || [])) byId[d.id] = d
      if (json.info && json.info.more_records) page++
      else break
    }
  }
  return Object.values(byId)
}

// ===== main sync =====

async function runSync(opts = {}) {
  const { month, since: sinceOpt, until: untilOpt } = opts

  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET || !process.env.ZOHO_REFRESH_TOKEN) {
    return { status: 200, body: { ok: false, pending: true, message: 'Zoho credentials not configured.' } }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return { status: 500, body: { error: 'Missing Supabase credentials' } }
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  let since, until, m
  if (sinceOpt && untilOpt) {
    since = sinceOpt; until = untilOpt; m = `${since}_${until}`
  } else {
    const mArg = month || currentMonth()
    const [y, mm] = mArg.split('-').map(Number)
    since = `${y}-${String(mm).padStart(2, '0')}-01`
    const lastDay = new Date(y, mm, 0).getDate()
    until = `${y}-${String(mm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    m = mArg
  }

  const { data: projects, error: projectsError } = await supabase.from('projects').select('id, name, client_id')
  if (projectsError) return { status: 500, body: { error: 'Failed to load projects: ' + projectsError.message } }

  // SAFETY: Zoho data must ONLY ever be written to BCureLaser-named projects.
  // The dashboard live-fetch calls this route with the currently-open projectId for ALL
  // clients (alongside bmby/fetch); without this guard a Zoho report would be upserted onto
  // BMBY projects (ONCE/REHAVIA), racing the BMBY write on the same (project,crm,month) key
  // and rendering the Zoho layout. Always require the bcurelaser name, then optionally narrow by projectId.
  const projectsList = (projects || []).filter(p =>
    (p.name || '').toLowerCase().includes('bcurelaser') &&
    (!opts.projectId || p.id === opts.projectId)
  )

  if (projectsList.length === 0) {
    return { status: 200, body: { ok: false, message: 'No BCureLaser project found in Supabase.' } }
  }

  let accessToken
  try { accessToken = await getZohoAccessToken() }
  catch (err) { return { status: 500, body: { error: 'Zoho OAuth failed: ' + (err.message || String(err)) } } }

  // ===== Fetch leads: BCureLaser + digital, INCLUDING converted leads =====
  const leadFields = [
    'Lead_Status', 'Lead_Source', 'Sub_Lead_Source', 'Created_Time',
    'timeOfLastCall', 'sumCalls', 'sumAnswerCalls',
    'field9', 'field20', 'segment', 'Owner', 'City1',
  ].join(',')

  const leadCriteria =
    `((segment:equals:bcurelaser)and(Lead_Source:equals:דיגיטל)` +
    `and(Created_Time:between:${since}T00:00:00+03:00,${until}T23:59:59+03:00))`

  let rawLeads = []
  try {
    rawLeads = await searchPaginated(accessToken, 'Leads', leadCriteria, leadFields, 'both')
  } catch (err) {
    return { status: 500, body: { error: 'Leads fetch failed: ' + (err.message || String(err)) } }
  }
  // Keep only the approved digital sub-sources
  const leads = rawLeads.filter(r => DIGITAL_SUBSOURCES.has((r.Sub_Lead_Source || '').toLowerCase()))
  const leadIds = leads.map(l => l.id)
  const leadIdSet = new Set(leadIds)

  // ===== Fetch deals linked to those leads (deal.LidID = lead.id) =====
  const dealFields = 'Deal_Name,Stage,Amount,Closing_Date,Created_Time,Stage_Modified_Time,device_quantity,cancellation_date,LidID,segment'
  let linkedDeals = []
  try {
    if (leadIds.length > 0) {
      linkedDeals = await fetchDealsByLeadIds(accessToken, leadIds, dealFields)
    }
  } catch (err) {
    return { status: 500, body: { error: 'Deals fetch failed: ' + (err.message || String(err)) } }
  }
  linkedDeals = linkedDeals.filter(d => leadIdSet.has(d.LidID))

  // ===== Compute lead stats =====
  const IRRELEVANT_STATUSES = new Set(['כפול', 'לא תקין', 'לא מעוניין', 'מטופל על ידי נציג אחר/ליד כפול'])
  const byStatus = {}
  const bySource = {}
  const objections = {}
  const devices = {}

  for (const lead of leads) {
    const status = (lead.Lead_Status || 'לא ידוע').trim()
    byStatus[status] = (byStatus[status] || 0) + 1

    const sub = (lead.Sub_Lead_Source || 'לא ידוע').trim()
    bySource[sub] = (bySource[sub] || 0) + 1

    const obj = (lead.field9 || '').trim()
    if (obj) objections[obj] = (objections[obj] || 0) + 1

    const dev = (lead.field20 || 'לא הוצע').trim() || 'לא הוצע'
    devices[dev] = (devices[dev] || 0) + 1
  }

  // ===== Response time =====
  const responseTimes = []
  const byAgent = {}

  for (const lead of leads) {
    const agentName = (typeof lead.Owner === 'object' ? lead.Owner?.name : lead.Owner) || 'לא ידוע'
    const answered = num(lead.sumAnswerCalls || 0)
    const createdStr = (lead.Created_Time || '').replace(' ', 'T')
    const lastCallStr = (lead.timeOfLastCall || '').replace(' ', 'T')

    if (!answered || !lastCallStr || !createdStr) {
      if (!byAgent[agentName]) byAgent[agentName] = { count: 0, totalHours: 0, noResponse: 0 }
      byAgent[agentName].count++; byAgent[agentName].noResponse++
      responseTimes.push({ agentName, responseHours: null, noResponse: true, source: (lead.Sub_Lead_Source || 'אחר').trim() || 'אחר' })
      continue
    }

    const responseHours = Math.max(0, (new Date(lastCallStr) - new Date(createdStr)) / 3600000)
    if (!byAgent[agentName]) byAgent[agentName] = { count: 0, totalHours: 0, noResponse: 0 }
    byAgent[agentName].count++; byAgent[agentName].totalHours += responseHours
    responseTimes.push({ agentName, responseHours, noResponse: false, source: (lead.Sub_Lead_Source || 'אחר').trim() || 'אחר' })
  }

  const responded = responseTimes.filter(r => !r.noResponse)
  const avgHours = responded.length ? responded.reduce((s, r) => s + r.responseHours, 0) / responded.length : 0
  const respondedWithin1h = responded.length ? Math.round(responded.filter(r => r.responseHours <= 1).length / responded.length * 100) : 0
  const agentStats = Object.entries(byAgent).map(([name, s]) => ({
    name, count: s.count, noResponse: s.noResponse,
    avgHours: s.count > s.noResponse ? Math.round((s.totalHours / (s.count - s.noResponse)) * 10) / 10 : null,
  })).sort((a, b) => b.count - a.count)

  // Response-time distribution buckets + per-source averages (for the response report)
  const RT_BUCKETS = ['0-15m', '15m-1h', '1h-4h', '4h-8h', '8h-24h', '1d-3d', '3d+']
  const rtBucketOf = (h) => h <= 0.25 ? '0-15m' : h <= 1 ? '15m-1h' : h <= 4 ? '1h-4h' : h <= 8 ? '4h-8h' : h <= 24 ? '8h-24h' : h <= 72 ? '1d-3d' : '3d+'
  const rtBuckets = Object.fromEntries(RT_BUCKETS.map(b => [b, 0]))
  const rtBySourceMap = {}
  for (const r of responded) {
    rtBuckets[rtBucketOf(r.responseHours)]++
    if (!rtBySourceMap[r.source]) rtBySourceMap[r.source] = { count: 0, sumHours: 0 }
    rtBySourceMap[r.source].count++; rtBySourceMap[r.source].sumHours += r.responseHours
  }
  const rtBySource = Object.entries(rtBySourceMap)
    .map(([source, x]) => ({ source, count: x.count, avgHours: Math.round((x.sumHours / x.count) * 10) / 10 }))
    .sort((a, b) => b.count - a.count)

  // ===== Compute deal stats (lead-centric via LidID) =====
  // Opportunities (Id Count): distinct leads that have a linked deal.
  const opportunities = new Set(linkedDeals.map(d => d.LidID)).size
  // Purchased (Closing Date Count): linked deals that have a Closing_Date.
  const closedDeals = linkedDeals.filter(d => d.Closing_Date)
  const closedWithCancellation = closedDeals.filter(d => d.cancellation_date)
  const closedNoCancellation = closedDeals.filter(d => !d.cancellation_date)

  const grandTotal = closedDeals.reduce((s, d) => s + num(d.Amount || 0), 0)
  const netRevenue = closedNoCancellation.reduce((s, d) => s + num(d.Amount || 0), 0)
  const devicesSold = closedNoCancellation.reduce((s, d) => s + num(d.device_quantity || 1), 0)
  const avgDealValue = closedNoCancellation.length > 0 ? Math.round(netRevenue / closedNoCancellation.length) : 0

  const purchased = closedDeals.length
  const totalLeads = leads.length
  const closingRate = totalLeads > 0 ? Math.round((purchased / totalLeads) * 1000) / 10 : 0

  // ===== Funnel + drop-off (where leads/deals fall off) =====
  const oppLeadIds = new Set(linkedDeals.map(d => d.LidID))
  // Leads that never became an opportunity — broken down by Lead_Status (why they died)
  const notConvertedLeads = leads.filter(l => !oppLeadIds.has(l.id))
  const leadStatusDrop = {}
  for (const l of notConvertedLeads) {
    const st = (l.Lead_Status || 'לא ידוע').trim() || 'לא ידוע'
    leadStatusDrop[st] = (leadStatusDrop[st] || 0) + 1
  }
  // Opportunities that did not purchase (no Closing_Date) — broken down by deal Stage
  const openDeals = linkedDeals.filter(d => !d.Closing_Date)
  const openStageDrop = {}
  for (const d of openDeals) {
    const st = (d.Stage || 'לא ידוע').trim() || 'לא ידוע'
    openStageDrop[st] = (openStageDrop[st] || 0) + 1
  }
  const cancellations = closedWithCancellation.length
  const cancelledValue = closedWithCancellation.reduce((acc, d) => acc + num(d.Amount || 0), 0)
  const netPurchases = purchased - cancellations

  // ===== Per-channel funnel (which channel converts/earns best) =====
  const leadById = {}
  for (const l of leads) leadById[l.id] = l
  const normChan = (l) => ((l && l.Sub_Lead_Source) || 'אחר').trim() || 'אחר'
  const byChannel = {}
  const ensureChan = (c) => (byChannel[c] || (byChannel[c] = { leads: 0, opportunities: 0, purchased: 0, netRevenue: 0, _oppLeads: new Set() }))
  for (const l of leads) ensureChan(normChan(l)).leads++
  for (const d of linkedDeals) {
    const l = leadById[d.LidID]; if (!l) continue
    const c = ensureChan(normChan(l))
    c._oppLeads.add(d.LidID)
    if (d.Closing_Date) {
      c.purchased++
      if (!d.cancellation_date) c.netRevenue += num(d.Amount || 0)
    }
  }
  const channelFunnel = Object.entries(byChannel).map(([channel, c]) => ({
    channel,
    leads: c.leads,
    opportunities: c._oppLeads.size,
    purchased: c.purchased,
    netRevenue: Math.round(c.netRevenue),
    conversionRate: c.leads > 0 ? Math.round((c.purchased / c.leads) * 1000) / 10 : 0,
  })).sort((a, b) => b.leads - a.leads)
  const conversionRate = closingRate

  // ===== Build xlsxRows for aggregateCrmRows compatibility =====
  const sourcesMap = {}
  for (const lead of leads) {
    const src = (lead.Sub_Lead_Source || 'לא ידוע').trim() || 'לא ידוע'
    const status = (lead.Lead_Status || '').trim()
    const isIrrelevant = IRRELEVANT_STATUSES.has(status)
    if (!sourcesMap[src]) sourcesMap[src] = {
      totalLeads: 0, relevantLeads: 0, irrelevantLeads: 0,
      meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0,
      registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0,
    }
    sourcesMap[src].totalLeads++
    if (isIrrelevant) sourcesMap[src].irrelevantLeads++
    else sourcesMap[src].relevantLeads++
  }
  const xlsxRows = Object.entries(sourcesMap).map(([source, s]) => ({ source, ...s }))

  const summary = {
    crmType: 'zoho',
    totalLeads,
    relevantLeads: leads.filter(l => !IRRELEVANT_STATUSES.has((l.Lead_Status || '').trim())).length,
    irrelevantLeads: leads.filter(l => IRRELEVANT_STATUSES.has((l.Lead_Status || '').trim())).length,
    byStatus,
    bySource,
    objections,
    devices,
    responseTime: {
      avgHours: Math.round(avgHours * 10) / 10,
      respondedWithin1h,
      noResponseCount: responseTimes.length - responded.length,
      respondedCount: responded.length,
      byAgent: agentStats,
      buckets: rtBuckets,
      bucketOrder: RT_BUCKETS,
      bySource: rtBySource,
    },
    deals: {
      // ID COUNT — leads that became an opportunity (have a linked deal)
      opportunities,
      // CLOSING DATE COUNT — linked deals that have a Closing_Date (purchased)
      closed: purchased,
      // אחוז המרה — purchased / leads
      closingRate,
      // Revenue
      grandTotal: Math.round(grandTotal),
      revenue: Math.round(netRevenue),
      avgDealValue,
      devicesSold,
      cancellations: closedWithCancellation.length,
      // Pipeline breakdown
      pipeline: {
        pending: Math.max(0, opportunities - purchased),
        closed: purchased,
      },
    },
    // ===== BCureLaser medical funnel (phone-sales): leads -> opportunities -> purchased -> net =====
    funnel: {
      leads: totalLeads,
      opportunities,                       // leads that became a deal
      purchased,                           // linked deals with a Closing_Date
      cancellations,                       // of the purchased, how many cancelled
      netPurchases,                        // purchased minus cancellations
      conversionRate,                      // purchased / leads  (אחוז המרה לעסקה)
      netRevenue: Math.round(netRevenue),  // revenue after cancellations
      grossRevenue: Math.round(grandTotal),
      cancelledValue: Math.round(cancelledValue),
      avgDealValue,
      // drop-off detail
      leadsNotConverted: notConvertedLeads.length,
      leadStatusDrop,                      // why leads never became opportunities
      openStageDrop,                       // why opportunities have not purchased yet
      byChannel: channelFunnel,            // per-channel funnel (leads/opps/purchased/conv/revenue)
    },
    schemaVersion: ZOHO_SCHEMA_VERSION,
  }

  const results = []
  for (const p of projectsList) {
    const { error: upsertErr } = await supabase.from('reports').upsert({
      project_id: p.id,
      source: 'crm',
      month: m,
      data: xlsxRows,
      summary,
      file_name: 'Zoho CRM (live)',
      row_count: leads.length,
    }, { onConflict: 'project_id,source,month' })

    if (upsertErr) results.push({ project: p.name, error: upsertErr.message })
    else results.push({ project: p.name, leads: leads.length, opportunities, purchased, ok: true })
  }

  return { status: 200, body: { ok: true, month: m, totalLeads: leads.length, opportunities, purchased, projects: results } }
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
    const { status, body: responseBody } = await runSync({ month: body.month, since: body.since, until: body.until, projectId: body.projectId })
    return Response.json(responseBody, { status })
  } catch (err) {
    return Response.json({ error: 'runSync threw: ' + (err.message || String(err)) }, { status: 500 })
  }
}

export async function GET(request) {
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '')
  const expected = process.env.CRON_SECRET
  if (expected && bearer === expected) {
    const { status, body: responseBody } = await runSync()
    return Response.json(responseBody, { status })
  }
  return Response.json({ ok: true, configured: Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET && process.env.ZOHO_REFRESH_TOKEN) })
}
