// API route: /api/ga4/fetch
//   POST — admin UI / cron. Authorized by x-client-key = NEXT_PUBLIC_SUPABASE_ANON_KEY.
//   GET  — ?test=1 returns a live summary for verification; with Bearer CRON_SECRET runs the sync.
// Pulls GA4 Data API (property GA4_PROPERTY_ID) and writes a source='ga4' report per BCureLaser project.
// Auth: OAuth refresh token (GA4_OAUTH_*), reusing the existing Google OAuth client (no service-account key
// because the org blocks SA key creation). Scope: analytics.readonly.

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const GA4_SCHEMA_VERSION = 1

function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n }

function currentMonth() {
  const now = new Date()
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
}

// Resolve {startDate, endDate, m} for GA4 (YYYY-MM-DD) from opts (month or since/until).
function resolveRange(opts) {
  if (opts.since && opts.until) return { startDate: opts.since, endDate: opts.until, m: `${opts.since}_${opts.until}` }
  const mArg = opts.month || currentMonth()
  const [y, mm] = mArg.split('-').map(Number)
  const startDate = `${y}-${String(mm).padStart(2, '0')}-01`
  const lastDay = new Date(y, mm, 0).getDate()
  const endDate = `${y}-${String(mm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { startDate, endDate, m: mArg }
}

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: process.env.GA4_OAUTH_CLIENT_ID,
    client_secret: process.env.GA4_OAUTH_CLIENT_SECRET,
    refresh_token: process.env.GA4_OAUTH_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  })
  if (!res.ok) { const t = await res.text(); throw new Error(`OAuth token refresh failed ${res.status}: ${t.slice(0, 300)}`) }
  return (await res.json()).access_token
}

async function runReport(accessToken, propertyId, reqBody) {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody),
  })
  if (!res.ok) { const t = await res.text(); throw new Error(`GA4 API ${res.status}: ${t.slice(0, 500)}`) }
  return res.json()
}

const rows = (rep) => Array.isArray(rep?.rows) ? rep.rows : []
const dim = (r, i) => (r.dimensionValues?.[i]?.value ?? '')
const met = (r, i) => num(r.metricValues?.[i]?.value)

// ===== funnel-stage classification by host + path =====
function isMinisite(host, path) { return host.startsWith('lp.') && /bcurelaser-v2/i.test(path) }
function isSurvey(path)        { const p = (path || '').toLowerCase(); return p.includes('שאלון') || p.includes('%d7%a9%d7%90%d7%9c%d7%95%d7%9f') }
function isThankYou(path)      { return /thank[-_]?you/i.test(path || '') }
function isHome(host, path)    { return !host.startsWith('lp.') && (path === '/' || path === '') }

async function buildSummary(accessToken, propertyId, startDate, endDate) {
  const dateRanges = [{ startDate, endDate }]

  // A) New vs Returning x channel
  const repA = await runReport(accessToken, propertyId, {
    dateRanges,
    dimensions: [{ name: 'newVsReturning' }, { name: 'sessionDefaultChannelGroup' }],
    metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'engagedSessions' }],
    limit: 100,
  })
  let newUsers = 0, returningUsers = 0
  const byChannel = {}
  for (const r of rows(repA)) {
    const nvr = dim(r, 0); const ch = dim(r, 1) || '(other)'
    const users = met(r, 0), sess = met(r, 1), eng = met(r, 2)
    if (!byChannel[ch]) byChannel[ch] = { newUsers: 0, returningUsers: 0, sessions: 0, engagedSessions: 0 }
    if (/new/i.test(nvr)) { newUsers += users; byChannel[ch].newUsers += users }
    else if (/return/i.test(nvr)) { returningUsers += users; byChannel[ch].returningUsers += users }
    byChannel[ch].sessions += sess; byChannel[ch].engagedSessions += eng
  }

  // B) Page funnel (host + path)
  const repB = await runReport(accessToken, propertyId, {
    dateRanges,
    dimensions: [{ name: 'hostName' }, { name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
    limit: 1000,
  })
  const funnel = { minisiteViews: 0, minisiteUsers: 0, surveyViews: 0, surveyUsers: 0, thankYouViews: 0, thankYouUsers: 0, homeViews: 0, homeUsers: 0 }
  for (const r of rows(repB)) {
    const host = dim(r, 0), path = dim(r, 1)
    const views = met(r, 0), users = met(r, 1)
    if (isMinisite(host, path)) { funnel.minisiteViews += views; funnel.minisiteUsers += users }
    if (isSurvey(path))         { funnel.surveyViews += views; funnel.surveyUsers += users }
    if (isThankYou(path))       { funnel.thankYouViews += views; funnel.thankYouUsers += users }
    if (isHome(host, path))     { funnel.homeViews += views; funnel.homeUsers += users }
  }

  // C) Key events (leads split + purchases)
  const repC = await runReport(accessToken, propertyId, {
    dateRanges,
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }, { name: 'eventValue' }],
    limit: 200,
  })
  const events = {}
  let minisiteLeads = 0, websiteLeads = 0, purchases = 0, purchaseValue = 0, phoneCalls = 0
  for (const r of rows(repC)) {
    const name = dim(r, 0); const cnt = met(r, 0); const val = met(r, 1)
    events[name] = cnt
    const n = name.toLowerCase()
    if (/lead_lp|poptin/.test(n)) minisiteLeads += cnt
    else if (/lead_website|website_lead/.test(n)) websiteLeads += cnt
    if (n === 'purchase') { purchases += cnt; purchaseValue += val }
    if (/phone_call/.test(n)) phoneCalls += cnt
  }

  const totalUsers = newUsers + returningUsers
  return {
    schemaVersion: GA4_SCHEMA_VERSION,
    propertyId,
    range: { startDate, endDate },
    users: { total: totalUsers, new: newUsers, returning: returningUsers, newPct: totalUsers > 0 ? Math.round(newUsers / totalUsers * 100) : 0 },
    byChannel,
    funnel,                 // TOF=minisite, MOF=survey, BOF=thankYou/purchase, home=organic
    leads: { minisite: minisiteLeads, website: websiteLeads },
    purchases: { count: purchases, value: purchaseValue },
    phoneCalls,
    events,
  }
}

async function runSync(opts = {}) {
  const propertyId = process.env.GA4_PROPERTY_ID
  for (const e of ['GA4_PROPERTY_ID', 'GA4_OAUTH_CLIENT_ID', 'GA4_OAUTH_CLIENT_SECRET', 'GA4_OAUTH_REFRESH_TOKEN']) {
    if (!process.env[e]) return { status: 500, body: { error: `Missing env var: ${e}` } }
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return { status: 500, body: { error: 'Missing Supabase credentials' } }
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  const { startDate, endDate, m } = resolveRange(opts)

  let accessToken
  try { accessToken = await getAccessToken() } catch (err) { return { status: 500, body: { error: 'OAuth failed: ' + (err.message || String(err)) } } }

  let summary
  try { summary = await buildSummary(accessToken, propertyId, startDate, endDate) } catch (err) { return { status: 500, body: { error: err.message } } }

  // Route to BCureLaser project(s) only (GA4 property is BCureLaser-specific).
  const { data: projects, error: projErr } = await supabase.from('projects').select('id, name, client_id')
  if (projErr) return { status: 500, body: { error: 'Failed to load projects: ' + projErr.message } }
  const targets = (projects || []).filter(p =>
    (p.name || '').toLowerCase().includes('bcurelaser') && (!opts.projectId || p.id === opts.projectId)
  )

  const results = []
  for (const p of targets) {
    const { error: upErr } = await supabase.from('reports').upsert({
      project_id: p.id, source: 'ga4', month: m,
      data: [], summary, file_name: 'GA4 Data API (live)', row_count: 0,
    }, { onConflict: 'project_id,source,month' })
    results.push(upErr ? { project: p.name, error: upErr.message } : { project: p.name, users: summary.users.total })
  }

  return { status: 200, body: { ok: true, month: m, summary, projects: results } }
}

export async function POST(request) {
  const anon = request.headers.get('x-client-key')
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || anon !== process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body = {}
  try { body = await request.json() } catch {}
  const { status, body: resp } = await runSync({ month: body.month, since: body.since, until: body.until, projectId: body.projectId })
  return Response.json(resp, { status })
}

export async function GET(request) {
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '').trim()
  if (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) {
    const { status, body: resp } = await runSync()
    return Response.json(resp, { status })
  }
  // Gated live test: /api/ga4/fetch?test=1  (does NOT write to Supabase)
  if (new URL(request.url).searchParams.get('test') === '1') {
    const propertyId = process.env.GA4_PROPERTY_ID
    for (const e of ['GA4_PROPERTY_ID', 'GA4_OAUTH_CLIENT_ID', 'GA4_OAUTH_CLIENT_SECRET', 'GA4_OAUTH_REFRESH_TOKEN']) {
      if (!process.env[e]) return Response.json({ ok: false, error: `Missing env var: ${e}` }, { status: 500 })
    }
    try {
      const accessToken = await getAccessToken()
      const now = new Date(); const since = new Date(now); since.setDate(since.getDate() - 28)
      const fmt = (d) => d.toISOString().slice(0, 10)
      const summary = await buildSummary(accessToken, propertyId, fmt(since), fmt(now))
      return Response.json({ ok: true, summary })
    } catch (err) {
      return Response.json({ ok: false, error: String(err.message || err) }, { status: 500 })
    }
  }
  // TEMP gated diagnostic: /api/ga4/fetch?run=1[&month=YYYY-MM | &since=&until=] — runs full sync (writes) and returns result.
  if (new URL(request.url).searchParams.get('run') === '1') {
    const sp = new URL(request.url).searchParams
    const { status, body: resp } = await runSync({ month: sp.get('month') || undefined, since: sp.get('since') || undefined, until: sp.get('until') || undefined })
    return Response.json(resp, { status })
  }
  return Response.json({ ok: true, info: 'GA4 fetch route. Use ?test=1 to verify (after env vars set), POST to sync.' })
}
