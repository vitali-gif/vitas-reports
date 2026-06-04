// API route: /api/zoho/fetch
//   POST — from the admin UI (auth via x-client-key header = anon key)
//   GET  — from Vercel Cron (auth via Authorization: Bearer <CRON_SECRET>)
//
// Pulls BCureLaser leads + deals from Zoho CRM (segment=bcurelaser)
// and writes one `reports` row per month with source='crm', crmType='zoho'.
//
// Env vars required:
//   ZOHO_CLIENT_ID
//   ZOHO_CLIENT_SECRET
//   ZOHO_REFRESH_TOKEN
//   ZOHO_API_DOMAIN   (default: https://www.zohoapis.com)

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ZOHO_TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token'
const ZOHO_SCHEMA_VERSION = 1

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

// ===== Zoho API helpers =====

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

// Fetch all leads for BCureLaser in the given date range (cursor-paginated)
// Uses page_token (cursor) to go beyond Zoho's 2000-record page limit
async function fetchLeadsPaginated(accessToken, since, until) {
  const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com'
  const fields = [
    'Lead_Status', 'Lead_Source', 'Created_Time', 'Modified_Time',
    'timeOfLastCall', 'sumCalls', 'sumAnswerCalls',
    'field9', 'field20', 'segment', 'Owner', 'City1',
  ].join(',')

  const sinceISO = `${since}T00:00:00+03:00`
  const untilISO = `${until}T23:59:59+03:00`
  const criteria = encodeURIComponent(
    `((segment:equals:bcurelaser)and(Created_Time:between:${sinceISO},${untilISO}))`
  )
  // Base params used for ALL pages — page_token must see identical params
  const baseParams = `fields=${fields}&criteria=${criteria}&per_page=200&sort_by=Created_Time&sort_order=asc`
  const baseUrl = `${apiDomain}/crm/v7/Leads`

  const allLeads = []
  let pageToken = null   // cursor returned by Zoho after each page
  let page = 1
  let hasMore = true
  const MAX_PAGES = 50   // safety cap: up to 10,000 records

  while (hasMore && page <= MAX_PAGES) {
    // page_token replaces the page number but all other params must stay identical
    const url = pageToken
      ? `${baseUrl}?${baseParams}&page_token=${encodeURIComponent(pageToken)}`
      : `${baseUrl}?${baseParams}&page=${page}`

    const json = await zohoGet(accessToken, url)
    const records = json.data || []
    allLeads.push(...records)

    const info = json.info || {}
    hasMore = info.more_records === true
    pageToken = info.next_page_token || null
    page++
  }

  return allLeads
}

// Fetch deals in the given date range
async function fetchDealsPaginated(accessToken, since, until) {
  const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com'
  const fields = 'Deal_Name,Stage,Amount,Created_Time,Closing_Date,Owner'
  const sinceISO = `${since}T00:00:00+03:00`
  const untilISO = `${until}T23:59:59+03:00`
  const criteria = encodeURIComponent(
    `(Created_Time:between:${sinceISO},${untilISO})`
  )

  const allDeals = []
  let page = 1
  let hasMore = true
  const MAX_PAGES = 5

  while (hasMore && page <= MAX_PAGES) {
    const url = `${apiDomain}/crm/v7/Deals?fields=${fields}&criteria=${criteria}&page=${page}&per_page=200`
    const json = await zohoGet(accessToken, url)
    const records = json.data || []
    allDeals.push(...records)
    hasMore = json.info?.more_records === true
    page++
  }

  return allDeals
}

// ===== main sync logic =====

async function runSync(opts = {}) {
  const { month, since: sinceOpt, until: untilOpt } = opts

  // Check env vars
  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET || !process.env.ZOHO_REFRESH_TOKEN) {
    return {
      status: 200,
      body: {
        ok: false,
        pending: true,
        message: 'Zoho credentials not configured. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN in Vercel.',
      },
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    return { status: 500, body: { error: 'Missing Supabase credentials' } }
  }
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  // Build date range
  let since, until, m
  if (sinceOpt && untilOpt) {
    since = sinceOpt; until = untilOpt
    m = `${since}_${until}`
  } else {
    const mArg = month || currentMonth()
    const [y, mm] = mArg.split('-').map(Number)
    since = `${y}-${String(mm).padStart(2, '0')}-01`
    const lastDay = new Date(y, mm, 0).getDate()
    until = `${y}-${String(mm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    m = mArg
  }

  // Load projects from Supabase — find BCureLaser
  const { data: projects, error: projectsError } = await supabase
    .from('projects')
    .select('id, name, client_id')
  if (projectsError) return { status: 500, body: { error: 'Failed to load projects: ' + projectsError.message } }

  const projectsList = opts.projectId
    ? (projects || []).filter(p => p.id === opts.projectId)
    : (projects || []).filter(p => (p.name || '').toLowerCase().includes('bcurelaser'))

  if (projectsList.length === 0) {
    return {
      status: 200,
      body: { ok: false, message: 'No BCureLaser project found in Supabase. Add it via the admin panel or SQL INSERT.' },
    }
  }

  // Get Zoho access token
  let accessToken
  try {
    accessToken = await getZohoAccessToken()
  } catch (err) {
    return { status: 500, body: { error: 'Zoho OAuth failed: ' + (err.message || String(err)) } }
  }

  // Fetch leads + deals in parallel
  let leads = [], deals = []
  try {
    const [leadsRes, dealsRes] = await Promise.allSettled([
      fetchLeadsPaginated(accessToken, since, until),
      fetchDealsPaginated(accessToken, since, until),
    ])
    if (leadsRes.status === 'fulfilled') leads = leadsRes.value
    else throw new Error('Leads fetch failed: ' + (leadsRes.reason?.message || leadsRes.reason))
    if (dealsRes.status === 'fulfilled') deals = dealsRes.value
    // deals failure is non-fatal
  } catch (err) {
    return { status: 500, body: { error: err.message || String(err) } }
  }

  // ===== Compute stats =====

  // Irrelevant statuses (כפול, לא תקין, לא מעוניין, ...)
  const IRRELEVANT_STATUSES = new Set(['כפול', 'לא תקין', 'לא מעוניין'])

  // 1. By status
  const byStatus = {}
  for (const lead of leads) {
    const status = (lead.Lead_Status || 'לא ידוע').trim()
    byStatus[status] = (byStatus[status] || 0) + 1
  }

  // 2. By source (Lead_Source)
  const bySource = {}
  for (const lead of leads) {
    const source = (lead.Lead_Source || 'לא ידוע').trim()
    bySource[source] = (bySource[source] || 0) + 1
  }

  // 3. Objections (field9)
  const objections = {}
  for (const lead of leads) {
    const obj = (lead.field9 || '').trim()
    if (obj) objections[obj] = (objections[obj] || 0) + 1
  }

  // 4. Device offered (field20)
  const devices = {}
  for (const lead of leads) {
    const dev = (lead.field20 || 'לא הוצע').trim() || 'לא הוצע'
    devices[dev] = (devices[dev] || 0) + 1
  }

  // 5. Response time: Created_Time → timeOfLastCall (approximation)
  // Note: Zoho provides timeOfLastCall (last), not first. Used as approximation.
  const responseTimes = []
  const byAgent = {}

  for (const lead of leads) {
    const createdStr = lead.Created_Time || ''
    const lastCallStr = lead.timeOfLastCall || ''
    const agentName = (typeof lead.Owner === 'object' ? lead.Owner?.name : lead.Owner) || 'לא ידוע'
    const answered = num(lead.sumAnswerCalls || 0)

    if (!answered || !lastCallStr || !createdStr) {
      responseTimes.push({ agentName, responseHours: null, noResponse: true })
      if (!byAgent[agentName]) byAgent[agentName] = { count: 0, totalHours: 0, noResponse: 0 }
      byAgent[agentName].count++
      byAgent[agentName].noResponse++
      continue
    }

    const createdMs = new Date(createdStr).getTime()
    const lastCallMs = new Date(lastCallStr).getTime()
    if (isNaN(createdMs) || isNaN(lastCallMs)) {
      responseTimes.push({ agentName, responseHours: null, noResponse: true })
      continue
    }

    const responseHours = Math.max(0, (lastCallMs - createdMs) / (1000 * 60 * 60))
    responseTimes.push({ agentName, responseHours, noResponse: false })

    if (!byAgent[agentName]) byAgent[agentName] = { count: 0, totalHours: 0, noResponse: 0 }
    byAgent[agentName].count++
    byAgent[agentName].totalHours += responseHours
  }

  const responded = responseTimes.filter(r => !r.noResponse)
  const noResponseCount = responseTimes.length - responded.length
  const avgHours = responded.length
    ? responded.reduce((s, r) => s + r.responseHours, 0) / responded.length
    : 0
  const respondedWithin1h = responded.length
    ? Math.round((responded.filter(r => r.responseHours <= 1).length / responded.length) * 100)
    : 0

  const agentStats = Object.entries(byAgent).map(([name, s]) => ({
    name,
    count: s.count,
    avgHours: s.count > s.noResponse ? Math.round((s.totalHours / (s.count - s.noResponse)) * 10) / 10 : null,
    noResponse: s.noResponse,
  })).sort((a, b) => b.count - a.count)

  // 6. Deals analysis
  const CLOSED_STAGES = new Set(['Closed Won', 'נסגרה', 'נסגר', 'Won', 'סגור'])
  let dealsClosed = 0, dealsPending = 0, totalRevenue = 0
  for (const deal of deals) {
    const stage = (deal.Stage || '').trim()
    const amount = num(deal.Amount || 0)
    if (CLOSED_STAGES.has(stage)) {
      dealsClosed++
      totalRevenue += amount
    } else {
      dealsPending++
    }
  }

  // 7. Build per-source xlsxRows (for aggregateCrmRows compatibility in admin/page.js)
  const sourcesMap = {}
  for (const lead of leads) {
    const src = (lead.Lead_Source || 'לא ידוע').trim() || 'לא ידוע'
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

  // Aggregate totals
  const totalLeads = leads.length
  const totalIrrelevant = leads.filter(l => IRRELEVANT_STATUSES.has((l.Lead_Status || '').trim())).length
  const totalRelevant = totalLeads - totalIrrelevant

  // Summary object
  const summary = {
    crmType: 'zoho',
    totalLeads,
    relevantLeads: totalRelevant,
    irrelevantLeads: totalIrrelevant,
    byStatus,
    bySource,
    objections,
    devices,
    responseTime: {
      avgHours: Math.round(avgHours * 10) / 10,
      respondedWithin1h,
      noResponseCount,
      respondedCount: responded.length,
      byAgent: agentStats,
    },
    deals: {
      total: deals.length,
      closed: dealsClosed,
      pending: dealsPending,
      revenue: totalRevenue,
      avgDealValue: dealsClosed > 0 ? Math.round(totalRevenue / dealsClosed) : 0,
      pipeline: { pending: dealsPending, closed: dealsClosed },
    },
    schemaVersion: ZOHO_SCHEMA_VERSION,
  }

  // Upsert to all matching BCureLaser projects
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

    if (upsertErr) {
      results.push({ project: p.name, error: upsertErr.message })
    } else {
      results.push({ project: p.name, leads: leads.length, deals: deals.length, ok: true })
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      month: m,
      totalLeads: leads.length,
      totalDeals: deals.length,
      projects: results,
    },
  }
}

// ===== handlers =====

function isValidDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

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
    const { status, body: responseBody } = await runSync({
      month: body.month,
      since: body.since,
      until: body.until,
      projectId: body.projectId,
    })
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
  return Response.json({
    ok: true,
    configured: Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET && process.env.ZOHO_REFRESH_TOKEN),
  })
}
