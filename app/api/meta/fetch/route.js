// API route: /api/meta/fetch
//   POST — called from the admin UI. הרשאה: אדמין מאומת (JWT) או CRON_SECRET פנימי.
//   GET  — called by Vercel Cron hourly. Authorized by Authorization: Bearer <CRON_SECRET> (Vercel sets this automatically when CRON_SECRET env var is defined).
// Pulls Meta Ads insights and writes one report per project per month to Supabase.

import { requireFetchAccess } from '../../../../lib/auth'
// עזרי Meta והניתוב לפרויקטים עברו ל-lib/ads (שלב 2 של docs/daily-ranges-plan.md) — משותפים
// לעובדות היומיות. הקוד זהה; רק המיקום השתנה.
import { META_GRAPH_VERSION, num, extractLeads, metaFetchAll } from '../../../../lib/ads/meta-api.js'
import { klossAgencyOf, subProjectMatcher } from '../../../../lib/ads/routing.js'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 300  // was 60 — full-quarter fetches (q1-q4) exceeded 60s and returned 504

// ===== helpers =====

function currentMonth() {
  const now = new Date()
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
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
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
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

  // Resolve original full-resolution images via image_hash for all active image ads
  // (preferred over the post full_picture, which Meta returns at medium resolution)
  const hashesToFetch = new Set()
  for (const a of Object.values(adDetailsById)) {
    if (a.status === 'ACTIVE' && !a.videoId && a.imageHash) hashesToFetch.add(a.imageHash)
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
    campaignId: r.campaign_id || '',
    adsetId: r.adset_id || '',
    adId: r.ad_id || '',
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
    for (const r of allRows) { r.account = adAccountId; _allRowsMerged.push(r) }
    for (const a of activeAdsAll) { a.account = adAccountId; _activeAdsMerged.push(a) }
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
    .select('id, name, client_id, meta_account_id, sub_projects')

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
    const isKloss = needle === 'kloss'
    // 2026-09-13 — שיוך לפי חשבון מודעות. עד כה קמפיין שויך לפרויקט לפי הכלה של שם
    // הפרויקט בשם הקמפיין, מה שמחייב מוסכמת שמות ונשבר אצל לקוח שמריץ קמפיין לכל
    // בניין בשם אחר (שמי: HaZoarim / Shem Tov / Shabazi / Angel / Ben David).
    // כשהחשבון כולו שייך ללקוח אחד, `meta_account_id` על הפרויקט מנתב את כל שורותיו
    // אליו ומייתר את התאמת השמות. NULL = ההתנהגות הישנה, כך שאף פרויקט קיים לא מושפע.
    const _acct = (p.meta_account_id || '').toString().trim()
    const belongs = _acct
      ? (x) => String(x.account || '') === _acct
      : isKloss
        ? (x) => klossAgencyOf(x) !== null
        : (x) => (x.campaign || '').toLowerCase().includes(needle)
    const mine = allRows.filter(belongs)
    if (mine.length === 0) {
      results.push({ project: p.name, skipped: true, reason: _acct ? `no rows for ad account ${_acct}` : 'no matching campaigns' })
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
      .filter(belongs)
      .sort((a, b) => (b.metrics?.leads || 0) - (a.metrics?.leads || 0))

    // ── Server-side demographics aggregate ─────────────────────────────────────────
    // The dashboard's gender/age tables only need per-gender and per-age TOTALS (two separate
    // 1-D breakdowns, not per-ad and not the age×gender cross). Keyed identically to
    // lib/helpers.js aggregateRows (empty → 'לא ידוע'), so the numbers are byte-for-byte the
    // same as before. Stored in summary so the heavy per-ad×age×gender rows in `data` can be
    // collapsed to ad-level for slim projects without losing these tables.
    const demographics = { genders: {}, ages: {} }
    for (const r of mine) {
      const gk = r.gender || 'לא ידוע'
      const ak = r.age || 'לא ידוע'
      if (!demographics.genders[gk]) demographics.genders[gk] = { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 }
      if (!demographics.ages[ak])    demographics.ages[ak]    = { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 }
      const G = demographics.genders[gk], A = demographics.ages[ak]
      G.spend += r.spend; G.impressions += r.impressions; G.reach += r.reach; G.clicks += r.clicks; G.leads += r.leads
      A.spend += r.spend; A.impressions += r.impressions; A.reach += r.reach; A.clicks += r.clicks; A.leads += r.leads
    }

    // ── Slim `data` to ad-level — ש.ברוך projects ONLY (staged rollout) ────────────
    // Collapse the per-ad×age×gender rows into one row per ad (sum spend/impr/reach/clicks/
    // leads, drop age/gender/adText). The dashboard's campaign→adset→ad tree already sums to
    // ad-level, so the display is identical; the demographics come from summary.demographics
    // above. Other clients (BCureLaser/ISMOOTH) keep the full rows until this is proven.
    const SLIM_PROJECTS = ['hi park', 'once', 'rehavia', 'ismooth']
    const isSlim = SLIM_PROJECTS.includes((p.name || '').toLowerCase().trim())
    let dataToStore = mine
    if (isSlim) {
      const byAd = new Map()
      for (const r of mine) {
        const key = r.adId ? ('id\u0000' + r.adId) : ((r.campaign || '') + '\u0000' + (r.adSet || '') + '\u0000' + (r.adName || ''))
        let row = byAd.get(key)
        if (!row) {
          row = { campaign: r.campaign, adSet: r.adSet, adName: r.adName, campaignId: r.campaignId || '', adsetId: r.adsetId || '', adId: r.adId || '', spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0, campaignStatus: r.campaignStatus, adSetStatus: r.adSetStatus, adStatus: r.adStatus }
          byAd.set(key, row)
        }
        row.spend += r.spend; row.impressions += r.impressions; row.reach += r.reach; row.clicks += r.clicks; row.leads += r.leads
      }
      dataToStore = Array.from(byAd.values())
    }

    let byAgency = null
    if (isKloss) {
      byAgency = {}
      for (const r of mine) {
        const ag = klossAgencyOf(r) || 'אחר'
        const o = byAgency[ag] || (byAgency[ag] = { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 })
        o.spend += r.spend; o.impressions += r.impressions; o.reach += r.reach; o.clicks += r.clicks; o.leads += r.leads
      }
      for (const ag of Object.keys(byAgency)) { const o = byAgency[ag]; o.cpl = o.leads>0?o.spend/o.leads:0; o.cpc = o.clicks>0?o.spend/o.clicks:0; o.cpm = o.impressions>0?(o.spend/o.impressions)*1000:0; o.ctr = o.impressions>0?(o.clicks/o.impressions)*100:0 }
    }
    // ── פירוק פנימי לתת-פרויקטים ───────────────────────────────────────────────
    // הפרויקט נשאר אחד והסכום הכולל לא משתנה: כל שורה נספרת פעם אחת, בדלי אחד בלבד.
    // מה שלא נתפס נכנס ל"ללא שיוך" ולא נעלם — הסכום של הדליים שווה תמיד לסך הפרויקט.
    // `unmatchedAds` = 10 המודעות היקרות שלא נתפסו, כדי ששגיאת שם תיראה ולא תשתוק.
    let bySubProject = null
    let subProjectUnmatched = null
    const _subMatch = subProjectMatcher(p.sub_projects)
    if (_subMatch) {
      bySubProject = {}
      const _unm = new Map()
      for (const r of mine) {
        const key = _subMatch(r.adName) || 'ללא שיוך'
        const o = bySubProject[key] || (bySubProject[key] = { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 })
        o.spend += r.spend; o.impressions += r.impressions; o.reach += r.reach; o.clicks += r.clicks; o.leads += r.leads
        if (key === 'ללא שיוך') {
          const an = r.adName || '(ללא שם מודעה)'
          const u = _unm.get(an) || { adName: an, campaign: r.campaign || '', spend: 0, leads: 0 }
          u.spend += r.spend; u.leads += r.leads
          _unm.set(an, u)
        }
      }
      for (const k of Object.keys(bySubProject)) {
        const o = bySubProject[k]
        o.cpl = o.leads > 0 ? o.spend / o.leads : 0
        o.cpc = o.clicks > 0 ? o.spend / o.clicks : 0
        o.cpm = o.impressions > 0 ? (o.spend / o.impressions) * 1000 : 0
        o.ctr = o.impressions > 0 ? (o.clicks / o.impressions) * 100 : 0
      }
      subProjectUnmatched = Array.from(_unm.values()).sort((a, b) => b.spend - a.spend).slice(0, 10)
    }

    const summaryWithAds = {
      ...pt,
      ...(byAgency ? { byAgency } : {}),
      ...(bySubProject ? { bySubProject, subProjectUnmatched } : {}),
      demographics,
      activeAds: projectActiveAds,
      activeAdNames: projectActiveAds.map(a => a.name).filter(Boolean),
    }

    const { error: upsertError } = await supabase.from('reports').upsert({
      project_id: p.id,
      source: 'facebook',
      month: m,
      data: dataToStore,
      summary: summaryWithAds,
      file_name: 'Meta API (live)',
      row_count: dataToStore.length,
    }, { onConflict: 'project_id,source,month' })

    if (upsertError) {
      results.push({ project: p.name, error: upsertError.message })
    } else {
      results.push({
        project: p.name, rows: mine.length, spend: pt.spend, leads: pt.leads,
        ...(bySubProject ? {
          subProjects: Object.fromEntries(Object.entries(bySubProject).map(([k, o]) => [k, { spend: Math.round(o.spend), leads: Math.round(o.leads) }])),
        } : {}),
      })
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
  let body = {}
  try { body = await request.json() } catch {}
  const gate = await requireFetchAccess(request, body.projectId)
  if (!gate.ok) return gate.res
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

  // ── אילו סוגי action מטא בכלל מחזירה לחשבון הזה ─────────────────────────────
  // נדרש לפני בניית סרגל המשפך: "פתיחות טופס" הוא שלב שאולי אין לו נתון בכלל,
  // ואסור להציג שלב ריק כאפס. בנוסף זה מגלה אם החשבון מריץ Instant Form או דף
  // נחיתה — שני משפכים שאסור להציג באותו סרגל.
  // קריאה בלבד, מוגן ב-CRON_SECRET, לא נוגע ב-Supabase.
  if (expected && bearer === expected && new URL(request.url).searchParams.get('diag') === 'actions') {
    const _p = new URL(request.url).searchParams
    const acct = (_p.get('account') || '').replace(/\D/g, '')
    if (!acct) return Response.json({ error: 'account param required' }, { status: 400 })
    const _tok = process.env[`META_ACCESS_TOKEN_${acct}`] || process.env.META_ACCESS_TOKEN
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
    const since = _p.get('since') || `${today.slice(0, 8)}01`
    const until = _p.get('until') || today
    try {
      const tr = encodeURIComponent(JSON.stringify({ since, until }))
      const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/act_${acct}/insights`
        + `?level=campaign&fields=campaign_name,impressions,clicks,actions,cost_per_action_type`
        + `&time_range=${tr}&limit=500`
      const rows = await metaFetchAll(url, _tok)
      const byType = {}
      const byCampaign = []
      for (const r of rows) {
        const per = {}
        for (const a of (r.actions || [])) {
          const t = a.action_type, v = num(a.value)
          byType[t] = (byType[t] || 0) + v
          per[t] = (per[t] || 0) + v
        }
        byCampaign.push({
          campaign: r.campaign_name,
          impressions: num(r.impressions),
          clicks: num(r.clicks),
          actions: Object.fromEntries(Object.entries(per).sort((a, b) => b[1] - a[1])),
        })
      }
      return Response.json({
        ok: true, account: acct, since, until, campaigns: rows.length,
        actionTypes: Object.fromEntries(Object.entries(byType).sort((a, b) => b[1] - a[1])),
        byCampaign,
      })
    } catch (e) {
      return Response.json({ ok: false, error: String(e.message || e).slice(0, 800) }, { status: 200 })
    }
  }

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
