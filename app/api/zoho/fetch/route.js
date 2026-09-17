// API route: /api/zoho/fetch
//   POST — from the admin UI (הרשאה: אדמין מאומת (JWT) או CRON_SECRET פנימי)
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

import { requireFetchAccess } from '../../../../lib/auth'
import { createClient } from '@supabase/supabase-js'
import { computeZohoSummary, filterDigitalLeads } from '../../../../lib/crm/zoho-summary.js'
import { upsertRawRecords, rebuildCompactIfChanged } from '../../../../lib/crm/raw-store.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 300  // was 60 — per-brand loop (BCureLaser+ISMOOTH) + sequential deals fetch on last30 exceeded 60s → 504 (shown as blank 'HTTP ' in cron alerts)

const ZOHO_TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token'
// Zoho brands: match a project by a substring of its Supabase name, then map to the
// EXACT value stored in the Zoho `segment` field (Zoho `equals` is case-sensitive).
// BCureLaser + ISMOOTH share one Zoho org (parent client: Arika Carmel Ltd).
const ZOHO_BRANDS = [
  { match: 'bcurelaser', segment: 'bcurelaser' },
  { match: 'ismooth', segment: 'ISMOOTH' },
]
function brandForProjectName(name) {
  const n = (name || '').toLowerCase()
  return ZOHO_BRANDS.find(b => n.includes(b.match)) || null
}

// ===== helpers =====

function currentMonth() {
  const now = new Date()
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
}

// ===== Zoho OAuth =====

// Module-level access-token cache. Zoho access tokens live ~1h; refreshing one per
// request caused the cron (~12 jobs) to hammer the OAuth endpoint -> Zoho rate-limit
// ("too many requests continuously" / Access Denied), which then cascaded into
// "fetch failed" on the data calls. Caching the token (and serialising concurrent
// refreshes via a shared promise) collapses those ~12 refreshes to ~1 per warm instance.
let _zohoToken = null
let _zohoTokenExp = 0          // ms epoch when the cached token should be considered stale
let _zohoRefreshInFlight = null // shared promise so concurrent calls don't all refresh

async function _refreshZohoToken() {
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
    // On a transient rate-limit, fall back to a still-usable cached token if we have one.
    if (_zohoToken && (res.status === 400 || res.status === 429)) return _zohoToken
    throw new Error(`Zoho token refresh failed ${res.status}: ${txt.slice(0, 300)}`)
  }
  const json = await res.json()
  if (json.error) {
    if (_zohoToken) return _zohoToken
    throw new Error(`Zoho OAuth error: ${json.error}`)
  }
  _zohoToken = json.access_token
  _zohoTokenExp = Date.now() + 50 * 60 * 1000 // 50 min (tokens last ~60)
  return _zohoToken
}

async function getZohoAccessToken() {
  if (_zohoToken && Date.now() < _zohoTokenExp) return _zohoToken
  if (_zohoRefreshInFlight) return _zohoRefreshInFlight   // a refresh is already happening
  _zohoRefreshInFlight = _refreshZohoToken().finally(() => { _zohoRefreshInFlight = null })
  return _zohoRefreshInFlight
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
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY   // בלי נפילה חזרה למפתח הציבורי: חסר = 500 מפורש
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

  // ── רענון עסקאות (שלב 4): עסקאות שהשתנו ב-N הימים האחרונים, לכל מותג, אל crm_raw ──
  // עסקה של ליד ישן יכולה להיסגר/להתבטל הרבה אחרי החלון של הליד. במקום למשוך מחדש את
  // כל העסקאות של אלפי לידים, מושכים רק מה שהשתנה (Modified_Time) ודורסים ב-crm_raw.
  if (opts.dealsRefreshDays) {
    const days = Math.max(1, Math.min(60, Number(opts.dealsRefreshDays) || 7))
    const untilTs = new Date(), sinceTs = new Date(Date.now() - days * 86400000)
    const fmt = (d) => d.toISOString().slice(0, 19) + '+00:00'
    let accessToken
    try { accessToken = await getZohoAccessToken() }
    catch (err) { return { status: 500, body: { error: 'Zoho OAuth failed: ' + (err.message || String(err)) } } }
    const results = []
    for (const p of (projects || []).filter(p => brandForProjectName(p.name))) {
      const brand = brandForProjectName(p.name)
      const t0 = Date.now()
      try {
        const dealFields = 'Deal_Name,Stage,Amount,Closing_Date,Created_Time,Stage_Modified_Time,device_quantity,cancellation_date,LidID,segment'
        const criteria = `((segment:equals:${brand.segment})and(Modified_Time:between:${fmt(sinceTs)},${fmt(untilTs)}))`
        const deals = (await searchPaginated(accessToken, 'Deals', criteria, dealFields)).filter(d => d.LidID)
        const up = await upsertRawRecords(supabase, p.id, 'zoho', 'deals', deals)
        let compact = null
        try { compact = await rebuildCompactIfChanged(supabase, p.id, 'zoho', [up]) } catch (e) { compact = { error: String(e?.message || e) } }
        results.push({ project: p.name, ok: true, deals: up.count, days, ms: Date.now() - t0, compact })
      } catch (err) {
        results.push({ project: p.name, ok: false, error: String(err?.message || err).slice(0, 300), ms: Date.now() - t0 })
      }
    }
    return { status: 200, body: { ok: results.every(r => r.ok), mode: 'deals-refresh', days, projects: results } }
  }
  if (projectsError) return { status: 500, body: { error: 'Failed to load projects: ' + projectsError.message } }

  // SAFETY: Zoho data must ONLY ever be written to BCureLaser-named projects.
  // The dashboard live-fetch calls this route with the currently-open projectId for ALL
  // clients (alongside bmby/fetch); without this guard a Zoho report would be upserted onto
  // BMBY projects (ONCE/REHAVIA), racing the BMBY write on the same (project,crm,month) key
  // and rendering the Zoho layout. Always require the bcurelaser name, then optionally narrow by projectId.
  const projectsList = (projects || []).filter(p =>
    brandForProjectName(p.name) &&
    (!opts.projectId || p.id === opts.projectId)
  )

  if (projectsList.length === 0) {
    return { status: 200, body: { ok: false, message: 'No Zoho project found in Supabase.' } }
  }

  let accessToken
  try { accessToken = await getZohoAccessToken() }
  catch (err) { return { status: 500, body: { error: 'Zoho OAuth failed: ' + (err.message || String(err)) } } }

  const __allResults = []
  for (const __proj of projectsList) {
  const __brand = brandForProjectName(__proj.name)

  // ===== Fetch leads: BCureLaser + digital, INCLUDING converted leads =====
  const leadFields = [
    'Lead_Status', 'Lead_Source', 'Sub_Lead_Source', 'Created_Time',
    'timeOfLastCall', 'sumCalls', 'sumAnswerCalls',
    'field9', 'field20', 'segment', 'Owner', 'City1',
    'UTM_Campaign', 'UTM_Term', 'UTM_Content',
  ].join(',')

  const leadCriteria =
    `((segment:equals:${__brand.segment})and(Lead_Source:equals:דיגיטל)` +
    `and(Created_Time:between:${since}T00:00:00+03:00,${until}T23:59:59+03:00))`

  let rawLeads = []
  try {
    rawLeads = await searchPaginated(accessToken, 'Leads', leadCriteria, leadFields, 'both')
  } catch (err) {
    __allResults.push({ project: __proj.name, error: 'Leads fetch failed: ' + (err.message || String(err)) }); continue
  }
  const leads = filterDigitalLeads(rawLeads)
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
    __allResults.push({ project: __proj.name, error: 'Deals fetch failed: ' + (err.message || String(err)) }); continue
  }
  // החישוב — פונקציה טהורה ב-lib/crm/zoho-summary.js (שלב 4 של docs/daily-ranges-plan.md).
  const R = computeZohoSummary({ leads, deals: linkedDeals }, { since, until, prefiltered: true })
  const { xlsxRows, summary, opportunities, purchased } = R

  // תמונת מצב גולמית (crm_raw, crm_type=zoho): הלידים כפי שהתקבלו (לפני סינון תת-המקור) והעסקאות
  // המקושרות. מצטברת עם הזמן; טווח מותאם מחושב ממנה בלי לפנות ל-Zoho. כישלון לא מפיל את הריצה.
  let snapshot = null
  if (opts.snapshot !== false) {
    try {
      const [ls, ds] = await Promise.all([upsertRawRecords(supabase, __proj.id, 'zoho', 'leads', rawLeads), upsertRawRecords(supabase, __proj.id, 'zoho', 'deals', linkedDeals)])
      snapshot = { leads: ls, deals: ds }
      try { snapshot.compact = await rebuildCompactIfChanged(supabase, __proj.id, 'zoho', [ls, ds]) } catch (e) { snapshot.compact = { error: String(e?.message || e) } }
    } catch (e) { snapshot = { error: String(e?.message || e) } }
  }


  const { error: upsertErr } = await supabase.from('reports').upsert({
    project_id: __proj.id,
    source: 'crm',
    month: m,
    data: xlsxRows,
    summary,
    file_name: 'Zoho CRM (live)',
    row_count: leads.length,
  }, { onConflict: 'project_id,source,month' })

  if (upsertErr) __allResults.push({ project: __proj.name, error: upsertErr.message })
  else __allResults.push({ project: __proj.name, brand: __brand.segment, leads: leads.length, opportunities, purchased, ok: true, snapshot })
  } // ===== end per-brand loop =====

  return { status: 200, body: { ok: true, month: m, projects: __allResults } }
}

// ===== handlers =====

function isValidDate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) }

export async function POST(request) {
  let body = {}
  try { body = await request.json() } catch {}
  const gate = await requireFetchAccess(request, body.projectId)
  if (!gate.ok) return gate.res
  if ((body.since && !isValidDate(body.since)) || (body.until && !isValidDate(body.until))) {
    return Response.json({ error: 'invalid date format — use YYYY-MM-DD' }, { status: 400 })
  }
  try {
    const { status, body: responseBody } = await runSync({ month: body.month, since: body.since, until: body.until, projectId: body.projectId, dealsRefreshDays: gate.admin ? body.dealsRefreshDays : undefined, snapshot: gate.admin && body.snapshot === false ? false : undefined })
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
