// API route: /api/zoho/fetch
//   POST — from the admin UI (auth via x-client-key header = anon key)
//   GET  — from Vercel Cron (auth via Authorization: Bearer <CRON_SECRET>)
//
// Pulls BCureLaser leads + deals from Zoho CRM, writes to Supabase.
//
// Env vars required:
//   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN
//   ZOHO_API_DOMAIN  (default: https://www.zohoapis.com)

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ZOHO_TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token'
const ZOHO_SCHEMA_VERSION = 2

// BCureLaser: only count digital sub-sources
const DIGITAL_SUBSOURCES = new Set([
  'facebook', 'google', 'אתר חברה', 'וואטסאפ', 'whatsapp',
  'גוגל', 'פייסבוק', // Hebrew variants
])
const CLOSED_STAGES = new Set(['עסקה נסגרה', 'closed won', 'won', 'נסגרה', 'נסגר'])

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

async function zohoGet(accessToken, url) {
  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Zoho GET ${res.status}: ${txt.slice(0, 400)}`)
  }
  return res.json()
}

// Generic paginator: sort DESC by sortField, stop when records go before sinceMs.
// matchFn(record) → true to include in output.
async function fetchPaginated(accessToken, module, fields, sortField, sinceMs, untilMs, matchFn, maxPages = 40) {
  const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com'
  const baseParams = `fields=${fields}&per_page=200&sort_by=${sortField}&sort_order=desc`
  const baseUrl = `${apiDomain}/crm/v7/${module}`

  const results = []
  let pageToken = null
  let page = 1

  while (page <= maxPages) {
    const url = pageToken
      ? `${baseUrl}?${baseParams}&page_token=${encodeURIComponent(pageToken)}`
      : `${baseUrl}?${baseParams}&page=${page}`

    const json = await zohoGet(accessToken, url)
    const records = json.data || []
    if (records.length === 0) break

    let reachedBeforeSince = false
    for (const r of records) {
      const raw = (r[sortField] || '').replace(' ', 'T')
      if (!raw) continue  // skip records with NULL sort field (e.g. no Closing_Date yet)
      const ms = new Date(raw).getTime()
      if (isNaN(ms) || ms < sinceMs) { reachedBeforeSince = true; break }
      if (ms <= untilMs && matchFn(r)) results.push(r)
    }

    if (reachedBeforeSince) break
    const info = json.info || {}
    pageToken = info.next_page_token || null
    if (records.length < 200) break
    page++
  }

  return results
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

  const sinceMs = new Date(`${since}T00:00:00+03:00`).getTime()
  const untilMs = new Date(`${until}T23:59:59+03:00`).getTime()

  const { data: projects, error: projectsError } = await supabase.from('projects').select('id, name, client_id')
  if (projectsError) return { status: 500, body: { error: 'Failed to load projects: ' + projectsError.message } }

  const projectsList = opts.projectId
    ? (projects || []).filter(p => p.id === opts.projectId)
    : (projects || []).filter(p => (p.name || '').toLowerCase().includes('bcurelaser'))

  if (projectsList.length === 0) {
    return { status: 200, body: { ok: false, message: 'No BCureLaser project found in Supabase.' } }
  }

  let accessToken
  try { accessToken = await getZohoAccessToken() }
  catch (err) { return { status: 500, body: { error: 'Zoho OAuth failed: ' + (err.message || String(err)) } } }

  // ===== Fetch leads: BCureLaser + digital sub-sources only =====
  const leadFields = [
    'Lead_Status', 'Lead_Source', 'Sub_Lead_Source', 'Created_Time',
    'timeOfLastCall', 'sumCalls', 'sumAnswerCalls',
    'field9', 'field20', 'segment', 'Owner', 'City1',
  ].join(',')

  const isDigitalBCL = (r) => {
    if ((r.segment || '').toLowerCase() !== 'bcurelaser') return false
    if (r.Lead_Source !== 'דיגיטל') return false
    const sub = (r.Sub_Lead_Source || '').toLowerCase()
    return DIGITAL_SUBSOURCES.has(sub)
  }

  // ===== Fetch deals: BCureLaser only, two date dimensions =====
  const dealFields = 'Deal_Name,Stage,Amount,Closing_Date,Created_Time,device_quantity,cancellation_date,segment'

  const isBCLDeal = (r) => (r.segment || '').toLowerCase() === 'bcurelaser'
  // Opportunities = pending deals (not yet closed, not cancelled)
  const PENDING_STAGES = new Set(['ממתין להזמנה', 'הצעת מחיר', 'in progress', 'pending', 'open'])
  const isBCLPending = (r) => isBCLDeal(r) && !CLOSED_STAGES.has((r.Stage || '').toLowerCase()) && !CLOSED_STAGES.has(r.Stage || '') && !r.cancellation_date

  let leads = [], dealsCreated = [], dealsClosed = []
  try {
    const [leadsRes, dealsCreatedRes, dealsClosedRes] = await Promise.allSettled([
      fetchPaginated(accessToken, 'Leads', leadFields, 'Created_Time', sinceMs, untilMs, isDigitalBCL, 50),
      fetchPaginated(accessToken, 'Deals', dealFields, 'Created_Time', sinceMs, untilMs, isBCLPending, 30),
      fetchPaginated(accessToken, 'Deals', dealFields, 'Closing_Date', sinceMs, untilMs, isBCLDeal, 30),
    ])
    if (leadsRes.status === 'fulfilled') leads = leadsRes.value
    else throw new Error('Leads fetch failed: ' + leadsRes.reason?.message)
    if (dealsCreatedRes.status === 'fulfilled') dealsCreated = dealsCreatedRes.value
    if (dealsClosedRes.status === 'fulfilled') dealsClosed = dealsClosedRes.value
  } catch (err) {
    return { status: 500, body: { error: err.message || String(err) } }
  }

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
      responseTimes.push({ agentName, responseHours: null, noResponse: true })
      continue
    }

    const responseHours = Math.max(0, (new Date(lastCallStr) - new Date(createdStr)) / 3600000)
    if (!byAgent[agentName]) byAgent[agentName] = { count: 0, totalHours: 0, noResponse: 0 }
    byAgent[agentName].count++; byAgent[agentName].totalHours += responseHours
    responseTimes.push({ agentName, responseHours, noResponse: false })
  }

  const responded = responseTimes.filter(r => !r.noResponse)
  const avgHours = responded.length ? responded.reduce((s, r) => s + r.responseHours, 0) / responded.length : 0
  const respondedWithin1h = responded.length ? Math.round(responded.filter(r => r.responseHours <= 1).length / responded.length * 100) : 0
  const agentStats = Object.entries(byAgent).map(([name, s]) => ({
    name, count: s.count, noResponse: s.noResponse,
    avgHours: s.count > s.noResponse ? Math.round((s.totalHours / (s.count - s.noResponse)) * 10) / 10 : null,
  })).sort((a, b) => b.count - a.count)

  // ===== Compute deal stats =====
  // CLOSING DATE COUNT: deals closed in period (by Closing_Date)
  const closedDeals = dealsClosed.filter(d => CLOSED_STAGES.has((d.Stage || '').toLowerCase()) || CLOSED_STAGES.has(d.Stage || ''))
  const closedWithCancellation = closedDeals.filter(d => d.cancellation_date)
  const closedNoCancellation = closedDeals.filter(d => !d.cancellation_date)

  const grandTotal = closedDeals.reduce((s, d) => s + num(d.Amount || 0), 0)
  const netRevenue = closedNoCancellation.reduce((s, d) => s + num(d.Amount || 0), 0)
  const devicesSold = closedNoCancellation.reduce((s, d) => s + num(d.device_quantity || 1), 0)
  const avgDealValue = closedNoCancellation.length > 0 ? Math.round(netRevenue / closedNoCancellation.length) : 0

  const totalLeads = leads.length
  const closingRate = totalLeads > 0 ? Math.round((closedDeals.length / totalLeads) * 1000) / 10 : 0

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
    },
    deals: {
      // ID COUNT — opportunities created in period
      opportunities: dealsCreated.length,
      // CLOSING DATE COUNT — deals actually closed this period
      closed: closedDeals.length,
      closingRate,
      // Revenue
      grandTotal: Math.round(grandTotal),
      revenue: Math.round(netRevenue),
      avgDealValue,
      devicesSold,
      cancellations: closedWithCancellation.length,
      // Pipeline breakdown
      pipeline: {
        pending: dealsCreated.filter(d => !CLOSED_STAGES.has(d.Stage || '')).length,
        closed: closedDeals.length,
      },
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
    else results.push({ project: p.name, leads: leads.length, dealsCreated: dealsCreated.length, dealsClosed: closedDeals.length, ok: true })
  }

  return { status: 200, body: { ok: true, month: m, totalLeads: leads.length, dealsCreated: dealsCreated.length, dealsClosed: closedDeals.length, projects: results } }
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
