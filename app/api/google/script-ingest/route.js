// API route: /api/google/script-ingest
// Receives data POSTed from a Google Ads Script that runs inside the user's
// Google Ads account. This is "Plan B" while the official Google Ads API
// Basic Access application is pending.
//
// Authentication: shared secret (GOOGLE_SCRIPT_SECRET env var) sent as the
// "x-script-secret" header. Each customer account gets the same secret.
//
// The script POSTs a payload like:
// {
//   customer_id: "863-912-0262",
//   period: { since: "2026-04-01", until: "2026-04-30" },  // OR { month: "2026-04" }
//   campaigns: [
//     { name, status, type, spend, impressions, clicks, conversions, ad_groups: [...] }
//   ],
//   asset_groups: [ { name, campaign, status, headlines:[], descriptions:[], images:[] } ]  // optional, for PMax
// }
//
// We map customer_id -> projects via a lookup, aggregate per-project, and upsert
// into reports with source='google'.

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function num(v) {
  if (typeof v === 'number') return v
  if (v === null || v === undefined || v === '') return 0
  const n = parseFloat(String(v))
  return isNaN(n) ? 0 : n
}

function currentMonth() {
  const now = new Date()
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
}

export async function POST(request) {
  // Auth: shared secret in header
  const expected = process.env.GOOGLE_SCRIPT_SECRET
  const provided = request.headers.get('x-script-secret') || ''
  if (!expected || provided !== expected) {
    return Response.json({ error: 'Unauthorized — invalid x-script-secret header' }, { status: 401 })
  }

  let payload
  try { payload = await request.json() }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const customerId = payload.customer_id || payload.customerId || ''
  const campaigns = Array.isArray(payload.campaigns) ? payload.campaigns : []
  const assetGroups = Array.isArray(payload.asset_groups) ? payload.asset_groups : []

  // Determine period key (same conventions as our other endpoints).
  // If the date range covers a complete calendar month, normalize to YYYY-MM
  // so it matches data fetched via {month: 'YYYY-MM'}.
  let m
  if (payload.period?.since && payload.period?.until) {
    const since = payload.period.since
    const until = payload.period.until
    // Check if it's a full calendar month: YYYY-MM-01 to YYYY-MM-(last day)
    const sm = since.match(/^(\d{4})-(\d{2})-01$/)
    if (sm) {
      const y = parseInt(sm[1])
      const mo = parseInt(sm[2])
      const lastDay = new Date(y, mo, 0).getDate()
      const expectedUntil = `${sm[1]}-${sm[2]}-${String(lastDay).padStart(2, '0')}`
      if (until === expectedUntil) {
        m = `${sm[1]}-${sm[2]}`  // full month → clean YYYY-MM key
      } else {
        m = since + '_' + until
      }
    } else {
      m = since + '_' + until
    }
  } else if (payload.month) {
    m = payload.month
  } else if (payload.period?.month) {
    m = payload.period.month
  } else {
    m = currentMonth()
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return Response.json({ error: 'Missing Supabase env' }, { status: 500 })
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  // Load projects from DB
  const { data: projects, error: projectsError } = await supabase.from('projects').select('id, name')
  if (projectsError) return Response.json({ error: 'Failed to load projects: ' + projectsError.message }, { status: 500 })

  // Flatten ads to a rows list (similar to Meta schema for compatibility with the dashboard)
  const allRows = []
  for (const c of campaigns) {
    // For each campaign, walk down ad_groups → ads. If a level is missing OR
    // an empty array (e.g. PMax campaigns have ad_groups but no ads), fall back
    // to a placeholder so the campaign-level stats still produce a row.
    const adGroups = (Array.isArray(c.ad_groups) && c.ad_groups.length > 0) ? c.ad_groups : [{}]
    for (const ag of adGroups) {
      const ads = (Array.isArray(ag.ads) && ag.ads.length > 0) ? ag.ads : [{}]
      for (const ad of ads) {
        const spend = num(ad.spend ?? ag.spend ?? c.spend)
        const impr  = num(ad.impressions ?? ag.impressions ?? c.impressions)
        const clicks= num(ad.clicks ?? ag.clicks ?? c.clicks)
        const leads = num(ad.conversions ?? ag.conversions ?? c.conversions)
        allRows.push({
          campaign: c.name || '',
          adSet: ag.name || '',
          adName: ad.name || '',
          adText: ad.text || ad.headline || '',
          gender: '',
          age: '',
          spend,
          impressions: impr,
          reach: 0,
          clicks,
          leads,
        })
      }
    }
  }

  const computeTotals = (rows) => {
    const t = { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 }
    for (const r of rows) { t.spend += r.spend; t.impressions += r.impressions; t.clicks += r.clicks; t.leads += r.leads }
    t.cpl  = t.leads > 0 ? t.spend / t.leads : 0
    t.cpc  = t.clicks > 0 ? t.spend / t.clicks : 0
    t.cpm  = t.impressions > 0 ? (t.spend / t.impressions) * 1000 : 0
    t.ctr  = t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0
    t.convRate = t.clicks > 0 ? (t.leads / t.clicks) * 100 : 0
    t.frequency = 0
    return t
  }

  const results = []
  for (const p of projects || []) {
    const needle = (p.name || '').toLowerCase().trim()
    if (!needle) continue
    const mine = allRows.filter(r => (r.campaign || '').toLowerCase().includes(needle))
    if (mine.length === 0) {
      results.push({ project: p.name, skipped: true, reason: 'no matching campaigns' })
      continue
    }
    const totals = computeTotals(mine)
    const projectAGs = assetGroups.filter(ag => (ag.campaign || '').toLowerCase().includes(needle))
    const summary = { ...totals, assetGroups: projectAGs }

    const { error: upsertErr } = await supabase.from('reports').upsert({
      project_id: p.id,
      source: 'google',
      month: m,
      data: mine,
      summary,
      file_name: 'Google Ads Script',
      row_count: mine.length,
    }, { onConflict: 'project_id,source,month' })

    if (upsertErr) results.push({ project: p.name, error: upsertErr.message })
    else results.push({ project: p.name, rows: mine.length, spend: totals.spend, leads: totals.leads })
  }

  return Response.json({
    ok: true,
    month: m,
    customerId,
    totalRows: allRows.length,
    assetGroupsCount: assetGroups.length,
    projects: results,
    receivedAt: new Date().toISOString(),
  })
}

// Health check
export async function GET() {
  return Response.json({
    ok: true,
    configured: Boolean(process.env.GOOGLE_SCRIPT_SECRET),
    note: 'POST your script payload here with x-script-secret header. See docs.',
  })
}
