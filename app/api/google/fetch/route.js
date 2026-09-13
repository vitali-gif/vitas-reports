// API route: /api/google/fetch
//   POST — from the admin UI (הרשאה: אדמין מאומת (JWT) או CRON_SECRET פנימי)
//   GET  — from Vercel Cron (auth via Authorization: Bearer <CRON_SECRET>)
// Pulls Google Ads campaign/ad-level metrics via GAQL and writes one report per project per month.

import { requireAdmin } from '../../../../lib/auth'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 300  // was 60 — full-quarter fetches (q1-q4) exceeded 60s and returned 504

const GOOGLE_ADS_API_VERSION = 'v22'

// KLOSS multi-agency (Google): both accounts hold Kloss campaigns mixed with sister brands
// (Zula / Novo). Match by customer + campaign contains 'kloss', tag by agency.
const KLOSS_GOOGLE_SOURCES = [
  { customer: '9483793370', agency: 'סיגאווי', any: ['kloss', 'p-max', 'pmax'] },
  { customer: '4733225739', agency: 'VITAS', any: ['kloss'] },
]
function klossGoogleAgencyOf(r) {
  const camp = (r && r.campaign || '').toLowerCase()
  const cust = String(r && r.account)
  const sc = KLOSS_GOOGLE_SOURCES.find(s => s.customer === cust && (!s.any || s.any.some(k => camp.includes(k))))
  return sc ? sc.agency : null
}
const GOOGLE_SCHEMA_VERSION = 2  // bump when stored summary shape changes

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

// ── אישורי גישה לכל חשבון בנפרד ───────────────────────────────────────────────
// חשבון של לקוח יכול לשבת תחת MCC אחר, שהמשתמש של החיבור הראשי לא רשום עליו
// בכלל. במצב כזה אין login-customer-id ואין developer token שיפתרו את זה —
// צריך OAuth של משתמש אחר.
//
// הפתרון הוא אותו דפוס שכבר קיים במטא (META_ACCESS_TOKEN_<accountId>): לכל
// משתנה סביבה אפשר להוסיף סיומת של מזהה הלקוח, והיא גוברת עליו רק לאותו חשבון.
// למשל GOOGLE_ADS_REFRESH_TOKEN_2713605466.
//
// זה מכוון: החיבור הראשי לא זז. אם החיבור החדש נשבר, החשבון שלו לבדו נופל
// והשאר ממשיכים — במקום להחליף אסימון משותף ולהפיל את כולם, כפי שקרה לנו במטא.
function credsFor(customerId) {
  const suf = String(customerId || '').replace(/\D/g, '')
  const pick = (base) => (suf && process.env[`${base}_${suf}`]) || process.env[base] || ''
  return {
    clientId: pick('GOOGLE_ADS_CLIENT_ID'),
    clientSecret: pick('GOOGLE_ADS_CLIENT_SECRET'),
    refreshToken: pick('GOOGLE_ADS_REFRESH_TOKEN'),
    developerToken: pick('GOOGLE_ADS_DEVELOPER_TOKEN'),
    loginCustomerId: pick('GOOGLE_ADS_LOGIN_CUSTOMER_ID').replace(/\D/g, ''),
    isOverride: !!(suf && process.env[`GOOGLE_ADS_REFRESH_TOKEN_${suf}`]),
  }
}

// אסימון גישה לכל refresh token נשלף פעם אחת, לא פעם לכל חשבון.
// המטמון חי ברמת המודול, כלומר שורד בין קריאות ב-lambda חמה — ולכן יש לו תפוגה.
// אסימון של גוגל תקף שעה; 50 דקות משאירות מרווח ומונעות 401 על אסימון שפג.
const _atCache = new Map()
async function getAccessToken(creds) {
  const c = creds || credsFor(null)
  if (!c.refreshToken) throw new Error('missing refresh token')
  const hit = _atCache.get(c.refreshToken)
  if (hit && hit.exp > Date.now()) return hit.token
  const token = await mintAccessToken(c)
  _atCache.set(c.refreshToken, { token, exp: Date.now() + 50 * 60 * 1000 })
  return token
}

async function mintAccessToken(c) {
  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    refresh_token: c.refreshToken,
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

// loginOverride: used only by the read-only account diagnostic below, to test a customer
// that sits under a DIFFERENT manager account than GOOGLE_ADS_LOGIN_CUSTOMER_ID.
// The sync itself never passes it, so its behaviour is unchanged.
async function gaqlSearch(accessToken, customerId, query, opts = {}) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': opts.developerToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  }
  const _login = opts.login || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
  if (_login) {
    headers['login-customer-id'] = String(_login).replace(/\D/g, '')
  }
  const allRows = []
  let nextPageToken = null
  let safety = 0
  while (safety < 20) {
    const body = { query }
    if (nextPageToken) body.pageToken = nextPageToken
    const res = await fetch(
      `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:search`,
      { method: 'POST', headers, body: JSON.stringify(body) }
    )
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`Google Ads API ${res.status}: ${txt.slice(0, 2000)}`)
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
  const required = ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN']
  for (const e of required) {
    if (!process.env[e]) return { status: 500, body: { error: `Missing env var: ${e}` } }
  }
  // Multi-account: GOOGLE_ADS_CUSTOMER_IDS = comma-separated customer IDs under the same MCC
  // (shares one OAuth + login-customer-id). Falls back to the legacy single GOOGLE_ADS_CUSTOMER_ID.
  // Rows from every customer are merged, then routed to projects by campaign-name substring match.
  // Additive merge: legacy single var (existing clients) + new comma-separated list, de-duped.
  // Setting GOOGLE_ADS_CUSTOMER_IDS to just the new customer is enough — the legacy one keeps working.
  const customerIds = [...new Set([
    ...(process.env.GOOGLE_ADS_CUSTOMER_ID || '').split(','),
    ...(process.env.GOOGLE_ADS_CUSTOMER_IDS || '').split(','),
  ].map((s) => s.trim().replace(/-/g, '')).filter(Boolean))]
  if (customerIds.length === 0) return { status: 500, body: { error: 'Missing GOOGLE_ADS_CUSTOMER_ID(S) env var' } }

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

  // האסימון הראשי נשלף מראש כדי שכשל OAuth כללי ייכשל מיד ובקול, ולא יתגלה
  // כשישה חשבונות אחר כך. חשבון עם אישורים משלו נשלף בתוך הלולאה.
  try {
    await getAccessToken(credsFor(null))
  } catch (err) {
    return { status: 500, body: { error: 'OAuth failed: ' + (err.message || String(err)) } }
  }

  // ===== per-customer fetch loop — merge rows/asset-groups across all customer IDs =====
  const _allRowsMerged = []
  const _assetGroupsMerged = {}
  const _custDiag = []
  for (const customerId of customerIds) {

  // אישורי הגישה של החשבון הזה. ברירת מחדל = החיבור הראשי; אם הוגדרו משתנים עם
  // סיומת מזהה הלקוח, הם גוברים רק כאן. כשל של חשבון אחד לא מפיל את השאר.
  const _creds = credsFor(customerId)
  const _gopts = { login: _creds.loginCustomerId, developerToken: _creds.developerToken }
  let accessToken
  try {
    accessToken = await getAccessToken(_creds)
  } catch (err) {
    _custDiag.push({ customer: customerId, credsOverride: _creds.isOverride, error: 'OAuth failed: ' + (err.message || String(err)) })
    continue
  }

  // Main query — ad-level metrics
  const query = `
    SELECT
      campaign.name,
      campaign.status,
      ad_group.name,
      ad_group.status,
      ad_group_ad.ad.name,
      ad_group_ad.ad.id,
      ad_group_ad.status,
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
    rawRows = await gaqlSearch(accessToken, customerId, query, _gopts)
  } catch (err) {
    _custDiag.push({ customer: customerId, error: err.message }); continue
  }

  // Transform ad_group_ad rows (Search/Display ad-level metrics)
  const allRows = rawRows.map(r => ({
    campaign: r.campaign?.name || '',
    campaignStatus: r.campaign?.status || '',
    adSet: r.adGroup?.name || '',
    adSetStatus: r.adGroup?.status || '',
    adName: r.adGroupAd?.ad?.name || (r.adGroupAd?.ad?.id ? `Ad ${r.adGroupAd.ad.id}` : ''),
    adId: r.adGroupAd?.ad?.id ? String(r.adGroupAd.ad.id) : '',
    adStatus: r.adGroupAd?.status || '',
    adText: extractAdText(r.adGroupAd?.ad),
    gender: '',
    age: '',
    spend: num(r.metrics?.costMicros) / 1_000_000,
    impressions: num(r.metrics?.impressions),
    reach: 0,
    clicks: num(r.metrics?.clicks),
    leads: num(r.metrics?.conversions),
  }))

  // ALSO query campaign-level metrics — this catches Performance Max campaigns which
  // don't have ad_group_ad rows. We add campaign-level totals for any campaign that
  // didn't appear in ad_group_ad results.
  try {
    const campQuery = `
      SELECT
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions
      FROM campaign
      WHERE segments.date BETWEEN '${since}' AND '${until}'
        AND campaign.status != 'REMOVED'
    `
    const campRows = await gaqlSearch(accessToken, customerId, campQuery, _gopts)
    const seenCampaigns = new Set(allRows.map(r => r.campaign).filter(Boolean))
    for (const r of campRows) {
      const cn = r.campaign?.name || ''
      if (!cn || seenCampaigns.has(cn)) continue  // already have ad-level data for this campaign
      // PMax / Smart / other "campaign-only" types — emit a single row per campaign
      const channelType = r.campaign?.advertisingChannelType || ''
      allRows.push({
        campaign: cn,
        campaignStatus: r.campaign?.status || '',
        adSet: channelType || '(campaign-level)',
        adSetStatus: '',
        adName: cn,
        adStatus: '',
        adText: '',
        gender: '',
        age: '',
        spend: num(r.metrics?.costMicros) / 1_000_000,
        impressions: num(r.metrics?.impressions),
        reach: 0,
        clicks: num(r.metrics?.clicks),
        leads: num(r.metrics?.conversions),
      })
    }
  } catch (err) {
    console.log('campaign-level query failed:', err.message || err)
  }

  const totals = computeTotals(allRows)

  // ===== Query active Asset Groups (Performance Max) + their assets =====
  let assetGroupsByCampaign = {}  // map: lowerCaseCampaignName -> [ {id, name, campaign, assets:[{type,text,imageUrl}]} ]
  try {
    // 1. asset groups with per-date-range metrics (PMax only)
    const agQuery = `
      SELECT
        asset_group.id,
        asset_group.name,
        asset_group.status,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM asset_group
      WHERE segments.date BETWEEN '${since}' AND '${until}'
        AND campaign.status != 'REMOVED'
    `
    let agRows = []
    try {
      agRows = await gaqlSearch(accessToken, customerId, agQuery, _gopts)
      console.log('[asset_group] rows returned:', agRows.length, agRows[0] ? JSON.stringify(agRows[0]).slice(0,300) : 'none')
    } catch (agErr) {
      console.log('[asset_group] metrics query failed:', agErr.message || agErr)
    }

    const agById = {}
    for (const r of agRows) {
      const id = r.assetGroup?.id
      if (!id) continue
      if (!agById[id]) {
        agById[id] = {
          id,
          name: r.assetGroup?.name || '',
          campaign: r.campaign?.name || '',
          status: r.assetGroup?.status || '',
          impressions: 0,
          clicks: 0,
          spend: 0,
          conversions: 0,
          assets: [],
        }
      }
      agById[id].impressions += Number(r.metrics?.impressions || 0)
      agById[id].clicks      += Number(r.metrics?.clicks      || 0)
      agById[id].spend       += Number(r.metrics?.costMicros  || 0) / 1_000_000
      agById[id].conversions += Number(r.metrics?.conversions || 0)
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
      const assetRows = await gaqlSearch(accessToken, customerId, assetQuery, _gopts)
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

    // accumulate this customer's results into the merged set, then close the per-customer loop
    for (const r of allRows) { r.account = customerId; _allRowsMerged.push(r) }
    for (const [k, arr] of Object.entries(assetGroupsByCampaign)) {
      if (!_assetGroupsMerged[k]) _assetGroupsMerged[k] = []
      for (const ag of arr) _assetGroupsMerged[k].push(ag)
    }
    _custDiag.push({ customer: customerId, rows: allRows.length, ...(_creds.isOverride ? { credsOverride: true, login: _creds.loginCustomerId || null } : {}) })
  } // ===== end per-customer loop =====

  const allRows = _allRowsMerged
  const assetGroupsByCampaign = _assetGroupsMerged
  const totals = computeTotals(allRows)

  // Split rows per project by campaign-name-contains match
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
    const isKloss = needle === 'kloss'
    const mine = isKloss ? allRows.filter(r => klossGoogleAgencyOf(r) !== null) : allRows.filter(r => (r.campaign || '').toLowerCase().includes(needle))
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

    let byAgency = null
    if (isKloss) {
      byAgency = {}
      for (const r of mine) {
        const ag = klossGoogleAgencyOf(r) || 'אחר'
        const o = byAgency[ag] || (byAgency[ag] = { spend: 0, impressions: 0, clicks: 0, leads: 0 })
        o.spend += r.spend; o.impressions += r.impressions; o.clicks += r.clicks; o.leads += r.leads
      }
      for (const ag of Object.keys(byAgency)) { const o = byAgency[ag]; o.cpl = o.leads>0?o.spend/o.leads:0; o.cpc = o.clicks>0?o.spend/o.clicks:0; o.ctr = o.impressions>0?(o.clicks/o.impressions)*100:0 }
    }
    const summaryWithAssetGroups = { ...pt, ...(byAgency ? { byAgency } : {}), assetGroups: projectAssetGroups }

    const { error: upsertErr } = await supabase.from('reports').upsert({
      project_id: p.id,
      source: 'google',
      month: m,
      data: mine,
      summary: { ...summaryWithAssetGroups, schemaVersion: GOOGLE_SCHEMA_VERSION },
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
      customersQueried: customerIds,
      customers: _custDiag,
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
  const gate = await requireAdmin(request)
  if (!gate.ok) return gate.res
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
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '')
  const expected = process.env.CRON_SECRET

  const _q = new URL(request.url).searchParams

  // ── אבחון חשבונות (קריאה בלבד, מוגן ב-CRON_SECRET) ───────────────────────────
  // למה: חשבון של לקוח חדש יכול לשבת תחת MCC אחר מזה שמוגדר ב-GOOGLE_ADS_LOGIN_CUSTOMER_ID.
  // במקרה כזה הוספת מזהה הלקוח ל-GOOGLE_ADS_CUSTOMER_IDS לבדה תיכשל, וההודעה של גוגל
  // ("USER_PERMISSION_DENIED") לא מסגירה שהבעיה היא ה-login ולא ההרשאה עצמה.
  // כאן מיפוי מלא של מה שה-refresh token רואה, כדי לדעת מראש ולא לנחש.
  // אין כאן שום כתיבה, ואין נגיעה ב-runSync.
  if (expected && bearer === expected && _q.get('diag') === 'accounts') {
    const target = (_q.get('customer') || '').replace(/-/g, '')
    try {
      const _dc = credsFor(target)
      const accessToken = await getAccessToken(_dc)
      const listRes = await fetch(
        `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`,
        { headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': _dc.developerToken } }
      )
      const listJson = await listRes.json()
      if (!listRes.ok) return Response.json({ ok: false, step: 'listAccessibleCustomers', error: listJson }, { status: listRes.status })
      const roots = (listJson.resourceNames || []).map(rn => String(rn).split('/').pop())

      const TREE_QUERY = `SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager,
        customer_client.level, customer_client.status, customer_client.currency_code
        FROM customer_client WHERE customer_client.status != 'CANCELED'`

      const managers = []
      const seen = new Map()   // customerId -> { id, name, managers: [] }
      for (const root of roots) {
        try {
          const rows = await gaqlSearch(accessToken, root, TREE_QUERY, { login: root, developerToken: _dc.developerToken })
          const children = rows.map(r => ({
            id: String(r.customerClient?.id || ''),
            name: r.customerClient?.descriptiveName || '',
            isManager: !!r.customerClient?.manager,
            level: Number(r.customerClient?.level || 0),
            status: r.customerClient?.status || '',
          })).filter(c => c.id)
          managers.push({ root, ok: true, childCount: children.length, children })
          for (const c of children) {
            const e = seen.get(c.id) || { id: c.id, name: c.name, isManager: c.isManager, reachableVia: [] }
            if (!e.reachableVia.includes(root)) e.reachableVia.push(root)
            if (!e.name && c.name) e.name = c.name
            seen.set(c.id, e)
          }
        } catch (e) {
          managers.push({ root, ok: false, error: String(e.message || e).slice(0, 400) })
        }
      }

      let targetReport = null
      if (target) {
        const hit = seen.get(target)
        targetReport = hit
          ? { found: true, ...hit, note: `הוסף את ${target} ל-GOOGLE_ADS_CUSTOMER_IDS; login-customer-id צריך להיות אחד מ-${hit.reachableVia.join(', ')}` }
          : { found: false, note: `${target} לא נמצא תחת אף אחד מה-MCC שה-refresh token רואה (${roots.join(', ')})` }
      }

      return Response.json({
        ok: true,
        currentLoginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || null,
        currentCustomerIds: (process.env.GOOGLE_ADS_CUSTOMER_IDS || process.env.GOOGLE_ADS_CUSTOMER_ID || ''),
        accessibleRoots: roots,
        managers,
        target: targetReport,
      })
    } catch (err) {
      return Response.json({ ok: false, step: 'diag', error: String(err.message || err) }, { status: 500 })
    }
  }

  // באיזה חשבון גוגל הדשבורד מחובר. כשחשבון לקוח לא נגיש, זה ההבדל בין
  // "להוסיף את המשתמש ל-MCC" לבין "להוציא refresh token חדש" - ובלי זה מנחשים.
  // מחזיר רק זהות והרשאות, אף פעם לא את האסימון עצמו.
  if (expected && bearer === expected && _q.get('diag') === 'whoami') {
    try {
      const _who = credsFor((_q.get('customer') || '').replace(/-/g, ''))
      const accessToken = await getAccessToken(_who)
      const out = { ok: true, customer: _q.get('customer') || null, credsOverride: _who.isOverride, loginCustomerId: _who.loginCustomerId || null }
      try {
        const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`)
        const j = await r.json()
        out.tokeninfo = { email: j.email || null, scope: j.scope || null, aud: j.aud || null, expires_in: j.expires_in || null }
      } catch (e) { out.tokeninfo = { error: String(e.message || e).slice(0, 200) } }
      try {
        const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } })
        out.userinfo = r.ok ? await r.json() : { status: r.status, note: 'OAuth scope does not include email/profile' }
      } catch (e) { out.userinfo = { error: String(e.message || e).slice(0, 200) } }
      out.clientIdTail = (process.env.GOOGLE_ADS_CLIENT_ID || '').slice(-30) || null
      return Response.json(out)
    } catch (err) {
      return Response.json({ ok: false, error: String(err.message || err) }, { status: 500 })
    }
  }

  // בדיקת משיכה אמיתית מחשבון בודד, עם login-customer-id לבחירה. קריאה בלבד.
  if (expected && bearer === expected && _q.get('diag') === 'probe') {
    const cust = (_q.get('customer') || '').replace(/-/g, '')
    const login = (_q.get('login') || '').replace(/-/g, '') || undefined
    if (!cust) return Response.json({ ok: false, error: 'customer param required' }, { status: 400 })
    try {
      const _c = credsFor(cust)
      const accessToken = await getAccessToken(_c)
      const rows = await gaqlSearch(accessToken, cust, `SELECT campaign.id, campaign.name, campaign.advertising_channel_type, campaign.status,
        metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
        FROM campaign WHERE segments.date DURING THIS_MONTH`, { login: login || _c.loginCustomerId, developerToken: _c.developerToken })
      return Response.json({
        ok: true, customer: cust, loginUsed: login || _c.loginCustomerId || null, credsOverride: _c.isOverride,
        campaignCount: rows.length,
        campaigns: rows.map(r => ({
          name: r.campaign?.name, type: r.campaign?.advertisingChannelType, status: r.campaign?.status,
          spend: Math.round(Number(r.metrics?.costMicros || 0) / 1e6),
          impressions: Number(r.metrics?.impressions || 0),
          clicks: Number(r.metrics?.clicks || 0),
          conversions: Number(r.metrics?.conversions || 0),
        })),
      })
    } catch (err) {
      return Response.json({ ok: false, customer: cust, loginUsed: login || null, error: String(err.message || err).slice(0, 1500) }, { status: 200 })
    }
  }

  if (expected && bearer === expected) {
    const { status, body: responseBody } = await runSync()
    return Response.json(responseBody, { status })
  }

  // Health check: verify we can get an access token
  try {
    const token = await getAccessToken()
    return Response.json({
      ok: true,
      customerIds: (process.env.GOOGLE_ADS_CUSTOMER_IDS || process.env.GOOGLE_ADS_CUSTOMER_ID || ''),
      loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || null,
      hasDeveloperToken: !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      accessTokenPreview: token ? token.slice(0, 20) + '...' : null,
      apiVersion: GOOGLE_ADS_API_VERSION,
    })
  } catch (err) {
    return Response.json({ ok: false, error: String(err.message || err) }, { status: 500 })
  }
}
