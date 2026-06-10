// API route: /api/meta/fetch
//   POST — called from the admin UI. Authorized by x-client-key = NEXT_PUBLIC_SUPABASE_ANON_KEY.
//   GET  — called by Vercel Cron hourly. Authorized by Authorization: Bearer <CRON_SECRET> (Vercel sets this automatically when CRON_SECRET env var is defined).
// Pulls Meta Ads insights and writes one report per project per month to Supabase.

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const META_GRAPH_VERSION = 'v21.0'

// ===== helpers =====

function currentMonth() {
  const now = new Date()
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
}

function num(v) {
  if (typeof v === 'number') return v
  if (!v) return 0
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? 0 : n
}

// Extract leads count from Meta actions array.
// Meta returns BOTH an aggregate 'lead' action AND specific sub-types (onsite_conversion.lead_grouped, etc).
// Summing them all double-counts. So we pick ONE source by priority to match what Ads Manager shows.
function extractLeads(actions) {
  if (!Array.isArray(actions)) return 0
  const getByType = (type) => {
    for (const a of actions) {
      if (a && a.action_type === type) return num(a.value)
    }
    return null
  }
  // Each ad's "result" = the conversion its campaign optimizes for (matches Ads Manager "Results"):
  //   lead-form campaigns  -> onsite_conversion.lead_grouped (on-Facebook Instant Forms)
  //   conversion campaigns -> custom conversion "LEAD | 2025" (offsite_conversion.custom.1586162569238898)
  // An ad belongs to one campaign type, so max() picks its real result with no double-counting.
  // Accounts without that custom conversion (e.g. ש.ברוך) -> lead2025 is null -> behaves like lead_grouped.
  const leadGrouped = getByType('onsite_conversion.lead_grouped')
  const lead2025 = getByType('offsite_conversion.custom.1586162569238898')
  if (leadGrouped !== null || lead2025 !== null) return Math.max(leadGrouped || 0, lead2025 || 0)
  // Fallbacks for rows/accounts without either of the above
  let v = getByType('offsite_conversion.fb_pixel_lead')
  if (v !== null) return v
  v = getByType('leadgen.other')
  if (v !== null) return v
  v = getByType('lead')
  return v !== null ? v : 0
}

async function metaFetchAll(url, token) {
  const out = []
  let next = url
  let safety = 0
  while (next && safety < 50) {
    const sep = next.includes('?') ? '&' : '?'
    const full = next.includes('access_token=') ? next : `${next}${sep}access_token=${encodeURIComponent(token)}`
    const res = await fetch(full)
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`Meta API ${res.status}: ${txt.slice(0, 400)}`)
    }
    const json = await res.json()
    if (Array.isArray(json.data)) out.push(...json.data)
    next = json.paging && json.paging.next ? json.paging.next : null
    safety++
  }
  return out
}

// ===== main sync logic (shared by GET and POST) =====

async function runSync(opts = {}) {
  const { month, since: sinceOpt, until: untilOpt } = opts
  const token = process.env.META_ACCESS_TOKEN
  // Multi-account support: META_AD_ACCOUNT_IDS = comma-separated list of ad accounts
  // (e.g. Vitas + BCureLaser). Falls back to the legacy single META_AD_ACCOUNT_ID.
  // Rows from every account are merged, then routed to projects by the existing
  // campaign-name substring match — so each client's account only feeds its own project.
  // Additive merge: legacy single var (existing clients) + new comma-separated list, de-duped.
  // Setting META_AD_ACCOUNT_IDS to just the new account is enough — the legacy one keeps working.
  const adAccountIds = [...new Set([
    ...(process.env.META_AD_ACCOUNT_ID || '').split(','),
    ...(process.env.META_AD_ACCOUNT_IDS || '').split(','),
  ].map((s) => s.trim()).filter(Boolean))]
  if (!token || adAccountIds.length === 0) {
    return { status: 500, body: { error: 'Missing META_ACCESS_TOKEN or META_AD_ACCOUNT_ID(S) env vars' } }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    return { status: 500, body: { error: 'Missing Supabase credentials' } }
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })

  let since, until, m
  if (sinceOpt && untilOpt) {
    // Custom date range mode
    since = sinceOpt
    until = untilOpt
    m = `${since}_${until}`  // e.g. "2026-03-01_2026-03-15"
  } else {
    // Month mode (default)
    const mArg = month || currentMonth()
    const [y, mm] = mArg.split('-').map(Number)
    since = `${y}-${String(mm).padStart(2, '0')}-01`
    const lastDay = new Date(y, mm, 0).getDate()
    until = `${y}-${String(mm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    m = mArg
  }
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }))

  const fields = [
    'campaign_name', 'campaign_id', 'adset_name', 'adset_id', 'ad_name', 'ad_id',
    'spend', 'impressions', 'reach', 'frequency',
    'clicks', 'inline_link_clicks', 'ctr', 'cpc', 'cpm',
    'actions',
  ].join(',')

  // ===== per-account fetch loop — merge rows/ads across all ad accounts =====
  const _allRowsMerged = []
  const _activeAdsMerged = []
  const _accountDiag = []
  const _mergedTotals = { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 }
  for (const adAccountId of adAccountIds) {
  // Per-account token override: META_ACCESS_TOKEN_<accountId> beats the default META_ACCESS_TOKEN.
  // Lets an ad account that lives in a different Business Manager use its own system-user token.
  const token = process.env['META_ACCESS_TOKEN_' + adAccountId] || process.env.META_ACCESS_TOKEN
  const breakdownUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/act_${adAccountId}/insights?level=ad&breakdowns=age,gender&fields=${fields}&time_range=${timeRange}&use_unified_attribution_setting=true&limit=500`

  // Fetch ad creative details (body, title, images) + status
  // NOTE: we intentionally do NOT request campaign{name}/adset{name} edges as they can fail on some tokens;
  // instead we use the breakdownRows below (which already contain campaign_name and adset_name keyed by ad_id).
  const adsFields = [
    'id', 'name', 'effective_status', 'status',
    'creative{body,title,image_url,thumbnail_url,image_hash,object_story_spec,asset_feed_spec,video_id,effective_object_story_id}',
  ].join(',')
  // Filter server-side to ACTIVE ads only; Meta's ?fields=creative{...} is expensive so we need effective_status filter + small limit
  const effectiveStatusFilter = encodeURIComponent(JSON.stringify(['ACTIVE']))
  const adsUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/act_${adAccountId}/ads?fields=${adsFields}&effective_status=${effectiveStatusFilter}&limit=50`

  // Fire both main fetches in parallel — independent of each other
  let breakdownRows = null
  let adsRaw = []
  let adsFetchError = null
  try {
    const [brRes, adsRes] = await Promise.allSettled([
      metaFetchAll(breakdownUrl, token),
      metaFetchAll(adsUrl, token),
    ])
    if (brRes.status === 'fulfilled') {
      breakdownRows = brRes.value
    } else {
      _accountDiag.push({ account: adAccountId, error: String(brRes.reason?.message || brRes.reason) }); continue
    }
    if (adsRes.status === 'fulfilled') {
      adsRaw = adsRes.value
    } else {
      adsFetchError = String(adsRes.reason?.message || adsRes.reason)
    }
  } catch (err) {
    _accountDiag.push({ account: adAccountId, error: String(err.message || err) }); continue
  }

  // Fetch campaign + adset effective_status maps (for status column in UI)
  const campStatusUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/act_${adAccountId}/campaigns?fields=id,effective_status,status&limit=500&access_token=${encodeURIComponent(token)}`
  const adsetStatusUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/act_${adAccountId}/adsets?fields=id,effective_status,status&limit=500&access_token=${encodeURIComponent(token)}`
  const campaignStatusById = {}
  const adSetStatusById = {}
  try {
    const [csRaw, asRaw] = await Promise.all([
      metaFetchAll(campStatusUrl, token),
      metaFetchAll(adsetStatusUrl, token),
    ])
    for (const c of csRaw) campaignStatusById[c.id] = c.effective_status || c.status || ''
    for (const a of asRaw) adSetStatusById[a.id] = a.effective_status || a.status || ''
  } catch {}

  // Helper: pull the best creative data (body, title, image) from nested Meta structures
  const extractCreative = (cr = {}) => {
    let body = cr.body || ''
    let title = cr.title || ''
    let imageUrl = cr.image_url || ''
    let thumb = cr.thumbnail_url || ''
    let videoId = ''
    const spec = cr.object_story_spec || {}
    if (!body) body = spec.link_data?.message || spec.video_data?.message || spec.photo_data?.message || ''
    if (!title) title = spec.link_data?.name || spec.video_data?.title || ''
    if (!imageUrl) imageUrl = spec.link_data?.picture || spec.photo_data?.url || ''
    if (spec.video_data?.video_id) videoId = spec.video_data.video_id
    if (!videoId && spec.video_data?.image_url && !thumb) thumb = spec.video_data.image_url
    const feed = cr.asset_feed_spec || {}
    if (!body && feed.bodies?.length) body = feed.bodies.map(b => b.text).filter(Boolean).join(' / ')
    if (!title && feed.titles?.length) title = feed.titles.map(t => t.text).filter(Boolean).join(' / ')
    if (!imageUrl && feed.images?.length) imageUrl = feed.images[0].url || ''
    if (!videoId && feed.videos?.length) videoId = feed.videos[0].video_id || ''
    const imageHash = cr.image_hash || spec.link_data?.image_hash || spec.photo_data?.image_hash || (feed.images && feed.images[0] && feed.images[0].hash) || ''
    return { body, title, imageUrl: imageUrl || thumb, thumbnailUrl: thumb || imageUrl, videoId, postId: cr.effective_object_story_id || '', imageHash }
  }

  const adBodyById = {}         // ad_id -> body (for breakdownRows)
  const adDetailsById = {}      // ad_id -> full detail object
  for (const ad of adsRaw) {
    const cr = ad.creative || {}
    const c = extractCreative(cr)
    adBodyById[ad.id] = c.body
    adDetailsById[ad.id] = {
      id: ad.id,
      name: ad.name || '',
      campaign: '',   // filled in below from breakdownRows
      adSet: '',      // filled in below from breakdownRows
      status: ad.effective_status || ad.status || '',
      body: c.body,
      title: c.title,
      imageUrl: c.imageUrl,
      thumbnailUrl: c.thumbnailUrl,
      videoId: c.videoId || (cr.video_id || ''),
      videoUrl: '',  // resolved later via /videos/{id}?fields=source
      postId: c.postId || '',
      imageHash: c.imageHash || '',
      metrics: { spend: 0, impressions: 0, clicks: 0, leads: 0 },
    }
  }
  // Back-fill campaign/adset names + per-ad metrics from the insights breakdownRows
  for (const r of breakdownRows) {
    const id = r.ad_id
    if (id && adDetailsById[id]) {
      if (!adDetailsById[id].campaign && r.campaign_name) adDetailsById[id].campaign = r.campaign_name
      if (!adDetailsById[id].adSet && r.adset_name) adDetailsById[id].adSet = r.adset_name
      const m = adDetailsById[id].metrics
      m.spend += num(r.spend)
      m.impressions += num(r.impressions)
      m.clicks += num(r.inline_link_clicks)
      m.leads += extractLeads(r.actions)
    }
  }

  // Resolve video source URLs (batched by /videos/{id}?fields=source) for ads with video_id
  const videoIdsSet = new Set()
  for (const a of Object.values(adDetailsById)) {
    if (a.status === 'ACTIVE' && a.videoId) videoIdsSet.add(a.videoId)
  }
  const videoUrlById = {}
  // Parallel: fire all requests at once, wait for all (Promise.all)
  await Promise.all([...videoIdsSet].map(async (vid) => {
    try {
      const vu = `https://graph.facebook.com/${META_GRAPH_VERSION}/${vid}?fields=source,permalink_url,picture&access_token=${encodeURIComponent(token)}`
      const vres = await fetch(vu)
      if (vres.ok) {
        const vjson = await vres.json()
        videoUrlById[vid] = {
          source: vjson.source || '',
          permalink: vjson.permalink_url || '',
          picture: vjson.picture || '',
        }
      }
    } catch {}
  }))
  for (const a of Object.values(adDetailsById)) {
    if (a.videoId && videoUrlById[a.videoId]) {
      a.videoUrl = videoUrlById[a.videoId].source || ''
      a.videoPermalink = videoUrlById[a.videoId].permalink || ''
      if (!a.imageUrl && videoUrlById[a.videoId].picture) a.imageUrl = videoUrlById[a.videoId].picture
      if (!a.thumbnailUrl && videoUrlById[a.videoId].picture) a.thumbnailUrl = videoUrlById[a.videoId].picture
    }
  }

  // Resolve high-res image URLs via post's full_picture for image ads (those with postId but no video)
  const postIdsToFetch = new Set()
  for (const a of Object.values(adDetailsById)) {
    if (a.status === 'ACTIVE' && a.postId && !a.videoId) postIdsToFetch.add(a.postId)
  }
  const fullPictureByPost = {}
  await Promise.all([...postIdsToFetch].map(async (pid) => {
    try {
      const pu = `https://graph.facebook.com/${META_GRAPH_VERSION}/${pid}?fields=full_picture,permalink_url&access_token=${encodeURIComponent(token)}`
      const pres = await fetch(pu)
      if (pres.ok) {
        const pjson = await pres.json()
        fullPictureByPost[pid] = {
          full: pjson.full_picture || '',
          permalink: pjson.permalink_url || '',
        }
      }
    } catch {}
  }))
  for (const a of Object.values(adDetailsById)) {
    if (a.postId && fullPictureByPost[a.postId]?.full) {
      // Prefer full_picture (higher res) as primary image
      a.imageUrl = fullPictureByPost[a.postId].full
      a.postPermalink = fullPictureByPost[a.postId].permalink || ''
    }
  }

  // Resolve high-res images via image_hash for active image ads that lack a usable post full_picture
  const hashesToFetch = new Set()
  for (const a of Object.values(adDetailsById)) {
    if (a.status === 'ACTIVE' && !a.videoId && a.imageHash && !(a.postId && fullPictureByPost[a.postId]?.full)) hashesToFetch.add(a.imageHash)
  }
  const urlByHash = {}
  if (hashesToFetch.size > 0) {
    const hashArr = [...hashesToFetch]
    for (let i = 0; i < hashArr.length; i += 50) {
      const chunk = hashArr.slice(i, i + 50)
      try {
        const iu = `https://graph.facebook.com/${META_GRAPH_VERSION}/act_${adAccountId}/adimages?hashes=${encodeURIComponent(JSON.stringify(chunk))}&fields=hash,url,permalink_url,width,height&access_token=${encodeURIComponent(token)}`
        const ires = await fetch(iu)
        if (ires.ok) {
          const ijson = await ires.json()
          for (const img of (ijson.data || [])) if (img.hash && img.url) urlByHash[img.hash] = img.url
        }
      } catch {}
    }
  }
  for (const a of Object.values(adDetailsById)) {
    if (a.imageHash && urlByHash[a.imageHash]) { a.imageUrl = urlByHash[a.imageHash]; if (!a.thumbnailUrl) a.thumbnailUrl = urlByHash[a.imageHash] }
  }
  const activeAdsAll = Object.values(adDetailsById).filter(a => a.status === 'ACTIVE')

  const buildRow = (r) => ({
    campaign: r.campaign_name || '',
    adSet: r.adset_name || '',
    adName: r.ad_name || '',
    adText: r.ad_id ? (adBodyById[r.ad_id] || '') : '',
    gender: r.gender || '',
    age: r.age || '',
    spend: num(r.spend),
    impressions: num(r.impressions),
    reach: num(r.reach),
    clicks: num(r.inline_link_clicks),  // link clicks only — matches Ads Manager 'Link clicks'
    leads: extractLeads(r.actions),
    campaignStatus: r.campaign_id ? (campaignStatusById[r.campaign_id] || '') : '',
    adSetStatus: r.adset_id ? (adSetStatusById[r.adset_id] || '') : '',
    adStatus: r.ad_id ? (adDetailsById[r.ad_id]?.status || '') : '',
  })

  const allRows = breakdownRows.map(buildRow)

  const totals = { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 }
  for (const r of allRows) {
    totals.spend += r.spend; totals.impressions += r.impressions
    totals.reach += r.reach; totals.clicks += r.clicks; totals.leads += r.leads
  }
  totals.cpl = totals.leads > 0 ? totals.spend / totals.leads : 0
  totals.cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0
  totals.cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0
  totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0
  totals.convRate = totals.clicks > 0 ? (totals.leads / totals.clicks) * 100 : 0
  totals.frequency = totals.reach > 0 ? totals.impressions / totals.reach : 0

    // accumulate this account's results into the merged set, then close the per-account loop
    for (const r of allRows) _allRowsMerged.push(r)
    for (const a of activeAdsAll) _activeAdsMerged.push(a)
    _mergedTotals.spend += totals.spend; _mergedTotals.impressions += totals.impressions
    _mergedTotals.reach += totals.reach; _mergedTotals.clicks += totals.clicks; _mergedTotals.leads += totals.leads
    _accountDiag.push({ account: adAccountId, rows: allRows.length, activeAds: activeAdsAll.length, adsIndexed: adsRaw.length, adsFetchError, videosResolved: Object.keys(videoUrlById).length, postsResolved: Object.keys(fullPictureByPost).length })
  } // ===== end per-account loop =====

  const allRows = _allRowsMerged
  const activeAdsAll = _activeAdsMerged
  const totals = _mergedTotals
  totals.cpl = totals.leads > 0 ? totals.spend / totals.leads : 0
  totals.cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0
  totals.cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0
  totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0
  totals.convRate = totals.clicks > 0 ? (totals.leads / totals.clicks) * 100 : 0
  totals.frequency = totals.reach > 0 ? totals.impressions / totals.reach : 0

  const { data: projects, error: projectsError } = await supabase
    .from('projects')
    .select('id, name, client_id')

  if (projectsError) {
    return { status: 500, body: { error: 'Failed to load projects: ' + projectsError.message } }
  }

  const projectsList = opts.projectId
    ? (projects || []).filter(p => p.id === opts.projectId)
    : (projects || [])

  const results = []
  for (const p of projectsList) {
    const needle = (p.name || '').toLowerCase().trim()
    if (!needle) continue
    const mine = allRows.filter(r => (r.campaign || '').toLowerCase().includes(needle))
    if (mine.length === 0) {
      results.push({ project: p.name, skipped: true, reason: 'no matching campaigns' })
      continue
    }

    const pt = { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 }
    for (const r of mine) {
      pt.spend += r.spend; pt.impressions += r.impressions
      pt.reach += r.reach; pt.clicks += r.clicks; pt.leads += r.leads
    }
    pt.cpl = pt.leads > 0 ? pt.spend / pt.leads : 0
    pt.cpc = pt.clicks > 0 ? pt.spend / pt.clicks : 0
    pt.cpm = pt.impressions > 0 ? (pt.spend / pt.impressions) * 1000 : 0
    pt.ctr = pt.impressions > 0 ? (pt.clicks / pt.impressions) * 100 : 0
    pt.convRate = pt.clicks > 0 ? (pt.leads / pt.clicks) * 100 : 0
    pt.frequency = pt.reach > 0 ? pt.impressions / pt.reach : 0

    // Filter active ads that belong to this project (campaign contains project name)
    // then sort by leads desc and keep top 5
    // Save ALL active ads for this project (not sliced to 5).
    // We use this list as a membership filter — only ads whose effective_status
    // is currently ACTIVE should be considered by the recommendations engine.
    const projectActiveAds = activeAdsAll
      .filter(a => (a.campaign || '').toLowerCase().includes(needle))
      .sort((a, b) => (b.metrics?.leads || 0) - (a.metrics?.leads || 0))

    const summaryWithAds = {
      ...pt,
      activeAds: projectActiveAds,
      activeAdNames: projectActiveAds.map(a => a.name).filter(Boolean),
    }

    const { error: upsertError } = await supabase.from('reports').upsert({
      project_id: p.id,
      source: 'facebook',
      month: m,
      data: mine,
      summary: summaryWithAds,
      file_name: 'Meta API (live)',
      row_count: mine.length,
    }, { onConflict: 'project_id,source,month' })

    if (upsertError) {
      results.push({ project: p.name, error: upsertError.message })
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
      accountsQueried: adAccountIds,
      activeAdsCount: activeAdsAll.length,
      accounts: _accountDiag,
      totals,
      projects: results,
    },
  }
}

// ===== handlers =====


// Validate that a value is a safe YYYY-MM-DD date string
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
  if ((body.since && !isValidDate(body.since)) || (body.until && !isValidDate(body.until))) { return Response.json({ error: 'invalid date format — use YYYY-MM-DD' }, { status: 400 }) }
  const { status, body: responseBody } = await runSync({
    month: body.month,
    since: body.since,
    until: body.until,
    projectId: body.projectId,
  })
  return Response.json(responseBody, { status })
}

export async function GET(request) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '')
  const expected = process.env.CRON_SECRET

  if (expected && bearer === expected) {
    // Authorized as Vercel Cron: run the sync
    const { status, body: responseBody } = await runSync()
    return Response.json(responseBody, { status })
  }

  // Otherwise: health check (public, safe to expose ad account name)
  const token = process.env.META_ACCESS_TOKEN
  const adAccountId = (process.env.META_AD_ACCOUNT_IDS || process.env.META_AD_ACCOUNT_ID || '').split(',').map((s) => s.trim()).filter(Boolean)[0]
  if (!token || !adAccountId) {
    return Response.json({ ok: false, error: 'Missing env vars' }, { status: 500 })
  }
  // TEMP diagnostic (gated): reveal which token identity / ad accounts this server token can see.
  if (new URL(request.url).searchParams.get('whoami') === '1') {
    try {
      const meRes = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/me?fields=id,name&access_token=${encodeURIComponent(token)}`)
      const me = await meRes.json()
      const accRes = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/adaccounts?fields=account_id,name&limit=500&access_token=${encodeURIComponent(token)}`)
      const accJson = await accRes.json()
      const accounts = (accJson.data || []).map((a) => ({ id: a.account_id, name: a.name }))
      return Response.json({ ok: true, identity: me, adAccountsCount: accounts.length, hasLaser: accounts.some((a) => a.id === '929034545061247'), accounts })
    } catch (e) {
      return Response.json({ ok: false, error: String(e.message || e) }, { status: 500 })
    }
  }
  try {
    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/act_${adAccountId}?fields=name,account_status,currency,timezone_name&access_token=${encodeURIComponent(token)}`
    const res = await fetch(url)
    const json = await res.json()
    if (!res.ok) return Response.json({ ok: false, error: json }, { status: res.status })
    return Response.json({ ok: true, adAccount: json })
  } catch (err) {
    return Response.json({ ok: false, error: String(err.message || err) }, { status: 500 })
  }
}
