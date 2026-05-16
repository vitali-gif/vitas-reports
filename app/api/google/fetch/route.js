// API route: /api/google/fetch
//   POST — from the admin UI (auth via x-client-key header = anon key)
//   GET  — from Vercel Cron (auth via Authorization: Bearer <CRON_SECRET>)
// Pulls Google Ads campaign/ad-level metrics via GAQL and writes one report per project per month.

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const GOOGLE_ADS_API_VERSION = 'v22'

// ===== helpers =====

function currentMonth() {
  const now = new Date()
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
}

function num(v) {
  if (typeof v === 'number') return v
  if (v === null || v === undefined || v === '') return 0
  const n = parseFloat(String(v))
  return isNaN(n) ? 0 : n
}

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID,
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`OAuth token refresh failed ${res.status}: ${txt.slice(0, 300)}`)
  }
  const json = await res.json()
  return json.access_token
}

async function gaqlSearch(accessToken, customerId, query) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  }
  if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    headers['login-customer-id'] = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
  }
  const allRows = []
  let nextPageToken = null
  let safety = 0
  while (safety < 20) {
    const body = { query, pageSize: 10000 }
    if (nextPageToken) body.pageToken = nextPageToken
    const res = await fetch(
      `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:search`,
      { method: 'POST', headers, body: JSON.stringify(body) }
    )
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`Google Ads API ${res.status}: ${txt.slice(0, 500)}`)
    }
    const json = await res.json()
    if (Array.isArray(json.results)) allRows.push(...json.results)
    nextPageToken = json.nextPageToken || null
    if (!nextPageToken) break
    safety++
  }
  return allRows
}

function extractAdText(ad) {
  if (!ad) return ''
  if (ad.textAd?.description1) return ad.textAd.description1
  if (ad.expandedTextAd?.description) return ad.expandedTextAd.description
  if (Array.isArray(ad.responsiveSearchAd?.descriptions)) {
    return ad.responsiveSearchAd.descriptions.map(d => d.text).filter(Boolean).join(' / ')
  }
  if (Array.isArray(ad.responsiveSearchAd?.headlines)) {
    return ad.responsiveSearchAd.headlines.map(d => d.text).filter(Boolean).join(' / ')
  }
  if (Array.isArray(ad.responsiveDisplayAd?.descriptions)) {
    return ad.responsiveDisplayAd.descriptions.map(d => d.text).filter(Boolean).join(' / ')
  }
  return ''
}

function computeTotals(rows) {
  const t = { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 }
  for (const r of rows) {
    t.spend += r.spend
    t.impressions += r.impressions
    t.reach += r.reach
    t.clicks += r.clicks
    t.leads += r.leads
  }
  t.cpl = t.leads > 0 ? t.spend / t.leads : 0
  t.cpc = t.clicks > 0 ? t.spend / t.clicks : 0
  t.cpm = t.impressions > 0 ? (t.spend / t.impressions) * 1000 : 0
  t.ctr = t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0
  t.convRate = t.clicks > 0 ? (t.leads / t.clicks) * 100 : 0
  t.frequency = t.reach > 0 ? t.impressions / t.reach : 0
  return t
}

// ===== main sync =====

async function runSync(opts = {}) {
  const { month, since: sinceOpt, until: untilOpt } = opts
  const required = ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID']
  for (const e of required) {
    if (!process.env[e]) return { status: 500, body: { error: `Missing env var: ${e}` } }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return { status: 500, body: { error: 'Missing Supabase credentials' } }
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  let since, until, m
  if (sinceOpt && untilOpt) {
    since = sinceOpt
    until = untilOpt
    m = `${since}_${until}`
  } else {
    const mArg = month || currentMonth()
    const [y, mm] = mArg.split('-').map(Number)
    since = `${y}-${String(mm).padStart(2, '0')}-01`
    const lastDay = new Date(y, mm, 0).getDate()
    until = `${y}-${String(mm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    m = mArg
  }

  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID

  let accessToken
  try {
    accessToken = await getAccessToken()
  } catch (err) {
    return { status: 500, body: { error: 'OAuth failed: ' + (err.message || String(err)) } }
  }

  // Main query — ad-level metrics
  const query = `
    SELECT
      campaign.name,
      ad_group.name,
      ad_group_ad.ad.name,
      ad_group_ad.ad.id,
      ad_group_ad.ad.text_ad.description1,
      ad_group_ad.ad.expanded_text_ad.description,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      ad_group_ad.ad.responsive_search_ad.headlines,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions
    FROM ad_group_ad
    WHERE segments.date BETWEEN '${since}' AND '${until}'
  `

  let rawRows
  try {
    rawRows = await gaqlSearch(accessToken, customerId, query)
  } catch (err) {
    return { status: 500, body: { error: err.message } }
  }

  // Transform to our common row schema (same as Facebook rows)
  const allRows = rawRows.map(r => ({
    campaign: r.campaign?.name || '',
    adSet: r.adGroup?.name || '',
    adName: r.adGroupAd?.ad?.name || (r.adGroupAd?.ad?.id ? `Ad ${r.adGroupAd.ad.id}` : ''),
    adText: extractAdText(r.adGroupAd?.ad),
    gender: '',
    age: '',
    spend: num(r.metrics?.costMicros) / 1_000_000,
    impressions: num(r.metrics?.impressions),
    reach: 0,
    clicks: num(r.metrics?.clicks),
    leads: num(r.metrics?.conversions),
  }))

  const totals = computeTotals(allRows)

  // ===== Query active Asset Groups (Performance Max) + their assets =====
  let assetGroupsByCampaign = {}  // map: lowerCaseCampaignName -> [ {id, name, campaign, assets:[{type,text,imageUrl}]} ]
  try {
    // 1. active asset groups
    const agQuery = `
      SELECT
        asset_group.id,
        asset_group.name,
        asset_group.status,
        campaign.name
      FROM asset_group
      WHERE asset_group.status = 'ENABLED'
    `
    const agRows = await gaqlSearch(accessToken, customerId, agQuery)

    const agById = {}
    for (const r of agRows) {
      const id = r.assetGroup?.id
      if (!id) continue
      agById[id] = {
        id,
        name: r.assetGroup?.name || '',
        campaign: r.campaign?.name || '',
        status: r.assetGroup?.status || '',
        assets: [],
      }
    }

    // 2. assets attached to those asset groups (headlines, descriptions, images)
    if (Object.keys(agById).length > 0) {
      const assetQuery = `
        SELECT
          asset_group.id,
          asset_group_asset.field_type,
          asset.text_asset.text,
          asset.image_asset.full_size.url,
          asset.youtube_video_asset.youtube_video_id,
          asset.name
        FROM asset_group_asset
        WHERE asset_group_asset.status = 'ENABLED'
      `
      const assetRows = await gaqlSearch(accessToken, customerId, assetQuery)
      for (const ar of assetRows) {
        const agId = ar.assetGroup?.id
        if (!agId || !agById[agId]) continue
        const type = ar.assetGroupAsset?.fieldType || 'UNKNOWN'
        const textVal = ar.asset?.textAsset?.text || ''
        const imgUrl = ar.asset?.imageAsset?.fullSize?.url || ''
        const ytId = ar.asset?.youtubeVideoAsset?.youtubeVideoId || ''
        agById[agId].assets.push({
          type,
          text: textVal,
          imageUrl: imgUrl,
          youtubeId: ytId,
          name: ar.asset?.name || '',
        })
      }
    }

    // 3. bucket by lowercase campaign name for project-matching
    for (const ag of Object.values(agById)) {
      const key = (ag.campaign || '').toLowerCase()
      if (!assetGroupsByCampaign[key]) assetGroupsByCampaign[key] = []
      assetGroupsByCampaign[key].push(ag)
    }
  } catch (err) {
    // non-fatal: if asset group query fails (e.g. permissions), continue without them
    console.log('asset_group query failed:', err.message || err)
  }

  // Split rows per project by campaign-name-contains match
  const { data: projects, error: projectsError } = await supabase
    .from('projects')
    .select('id, name, client_id')

  if (projectsError) {
    return { status: 500, body: { error: 'Failed to load projects: ' + projectsError.message } }
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

    const pt = computeTotals(mine)

    // Gather asset groups whose campaign name contains the project name
    const projectAssetGroups = []
    for (const [campLower, groups] of Object.entries(assetGroupsByCampaign)) {
      if (campLower.includes(needle)) projectAssetGroups.push(...groups)
    }

    const summaryWithAssetGroups = { ...pt, assetGroups: projectAssetGroups }

    const { error: upsertErr } = await supabase.from('reports').upsert({
      project_id: p.id,
      source: 'google',
      month: m,
      data: mine,
      summary: summaryWithAssetGroups,
      file_name: 'Google Ads API (live)',
      row_count: mine.length,
    }, { onConflict: 'project_id,source,month' })

    if (upsertErr) {
      results.push({ project: p.name, error: upsertErr.message })
    } else {
      results.push({ project: p.name, rows: mine.length, spend: pt.spend, leads: pt.leads })
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      month: m,
      totalRows: allRows.length,
      totals,
      projects: results,
    },
  }
}

// ===== handlers =====

export async function POST(request) {
  const anon = request.headers.get('x-client-key')
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || anon !== process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body = {}
  try { body = await request.json() } catch {}
  const { status, body: responseBody } = await runSync({
    month: body.month,
    since: body.since,
    until: body.until,
  })
  return Response.json(responseBody, { status })
}

export async function GET(request) {
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '')
  const expected = process.env.CRON_SECRET

  if (expected && bearer === expected) {
    const { status, body: responseBody } = await runSync()
    return Response.json(responseBody, { status })
  }

  // Health check: verify we can get an access token
  try {
    const token = await getAccessToken()
    const diag = globalThis.__GAdsOAuthDiag || {}
    return Response.json({
      ok: true,
      customerId: process.env.GOOGLE_ADS_CUSTOMER_ID,
      loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || null,
      hasDeveloperToken: !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      developerTokenLen: (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '').length,
      accessTokenPreview: token ? token.slice(0, 20) + '...' : null,
      oauthScope: diag.scope,
      oauthExpiresIn: diag.expires_in,
      apiVersion: GOOGLE_ADS_API_VERSION,
    })
  } catch (err) {
    return Response.json({ ok: false, error: String(err.message || err) }, { status: 500 })
  }
}
