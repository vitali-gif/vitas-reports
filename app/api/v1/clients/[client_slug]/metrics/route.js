/**
 * GET /api/v1/clients/{client_slug}/metrics
 *   ?project=hi-park&from=2026-08-17&to=2026-08-23
 *   &granularity=campaign|adset|ad   (default: ad)
 *   &platform=meta|google|all        (default: all)
 *   &refresh=1                        (optional: pull the period live if not cached)
 *   Authorization: Bearer <READ_TOKEN>
 *
 * READ-ONLY metrics feed for the campaign-management Claude sessions.
 * - Bearer token, hashed (SHA-256) and looked up in `api_tokens` (revocable, client-scoped).
 * - No admin access, no PII: aggregates only (no names/phones/emails; cities not addresses).
 * - Reads the cron-warmed reports cache (service-role). Core metrics at campaign→adset→ad;
 *   segments at the client/period level.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'
export const maxDuration = 300

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// ---- client / project registry (extend here for new clients) -------------
const CLIENTS = {
  sbaruch: {
    name: 'ש.ברוך',
    projects: {
      'hi-park': 'c2251f06-197b-43f0-b91c-4947f2e8760c',
      'once':    '0e09fdc5-a96a-4de0-8484-954746727830',
      'rehavia': '01f67914-75f4-4afc-ac18-3d9aa797fbba',
    },
  },
}

const J = (body, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, max-age=0' } })

const RTL = /[‎‏​‌‍‪-‮⁦-⁩﻿]/g
const rtl = (v) => (v || '').toString().replace(RTL, '').trim()
const norm = (v) => (v || '').toString().replace(RTL, '').replace(/\s*[-–]\s*עותק\s*\d*$/, '').replace(/\s*#\d+$/, '').trim()
const decode = (s) => !s ? s : String(s)
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)) } catch { return _ } })
  .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)) } catch { return _ } })
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const ratio = (num, den) => (den > 0 ? num / den : null)
const round2 = (v) => (v == null ? null : Math.round(v * 100) / 100)
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '')
const lastDayOfMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate() }

function platformOf(node) {
  const p = (node.platform || '').toString().toLowerCase()
  if (p === 'fb' || p === 'ig') return 'meta'
  const src = (node.source || '').toString()
  if (/facebook|פייסבוק|instagram|אינסטגרם|\bfb\b/i.test(src)) return 'meta'
  if (/google|גוגל|pmax|search/i.test(src)) return 'google'
  return null
}

export async function GET(request, ctx) {
  // HTTPS only
  const proto = request.headers.get('x-forwarded-proto')
  if (proto && proto !== 'https') return J({ error: 'https_required' }, 400)

  // ---- auth ----
  const auth = request.headers.get('authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return J({ error: 'missing_bearer_token' }, 401)
  const tokenHash = createHash('sha256').update(m[1].trim()).digest('hex')
  const { data: tok } = await supabaseAdmin
    .from('api_tokens').select('id, client_slug, revoked')
    .eq('token_hash', tokenHash).eq('revoked', false).maybeSingle()
  if (!tok) return J({ error: 'invalid_or_revoked_token' }, 401)

  const params = (ctx && ctx.params) ? await ctx.params : {}
  const clientSlug = params.client_slug
  if (tok.client_slug !== clientSlug) return J({ error: 'token_not_scoped_to_this_client' }, 403)
  const client = CLIENTS[clientSlug]
  if (!client) return J({ error: 'unknown_client_slug', valid: Object.keys(CLIENTS) }, 404)
  supabaseAdmin.from('api_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', tok.id).then(() => {}, () => {})

  // ---- params ----
  const { searchParams } = new URL(request.url)
  const projectSlug = searchParams.get('project')
  const from = searchParams.get('from'), to = searchParams.get('to')
  const granularity = (searchParams.get('granularity') || 'ad').toLowerCase()
  const platform = (searchParams.get('platform') || 'all').toLowerCase()
  const refresh = searchParams.get('refresh') === '1'
  const projectId = client.projects[projectSlug]
  if (!projectId) return J({ error: 'unknown_project', valid: Object.keys(client.projects) }, 404)
  if (!isDate(from) || !isDate(to)) return J({ error: 'from/to required as YYYY-MM-DD' }, 400)
  if (from > to) return J({ error: 'from must be <= to' }, 400)
  if (!['campaign', 'adset', 'ad'].includes(granularity)) return J({ error: 'granularity must be campaign|adset|ad' }, 400)
  if (!['meta', 'google', 'all'].includes(platform)) return J({ error: 'platform must be meta|google|all' }, 400)

  // ---- period key candidates ----
  const rangeKey = `${from}_${to}`
  const fullMonth = from.endsWith('-01') && from.slice(0, 7) === to.slice(0, 7) && Number(to.slice(8)) === lastDayOfMonth(to.slice(0, 7))
  const candidates = fullMonth ? [rangeKey, from.slice(0, 7)] : [rangeKey]

  const readReports = async () => {
    const { data } = await supabaseAdmin
      .from('reports').select('source, month, summary, data')
      .eq('project_id', projectId).in('month', candidates)
    return data || []
  }
  let reps = await readReports()
  let crm = reps.find(r => r.source === 'crm' && r.summary && Array.isArray(r.summary.adBreakdown))

  // Optional live pull when the period isn't cached yet.
  if (!crm && refresh) {
    const origin = new URL(request.url).origin
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    const body = JSON.stringify({ projectId, since: from, until: to })
    const hdr = { 'Content-Type': 'application/json', 'x-client-key': anon }
    await Promise.allSettled(['/api/bmby/fetch', '/api/meta/fetch', '/api/google/fetch']
      .map(u => fetch(origin + u, { method: 'POST', headers: hdr, body })))
    reps = await readReports()
    crm = reps.find(r => r.source === 'crm' && r.summary && Array.isArray(r.summary.adBreakdown))
  }
  if (!crm) {
    const { data: avail } = await supabaseAdmin
      .from('reports').select('month').eq('project_id', projectId).eq('source', 'crm')
      .order('created_at', { ascending: false }).limit(60)
    return J({
      error: 'period_not_cached',
      hint: 'add &refresh=1 to pull it live, or request a cached period',
      available_periods: [...new Set((avail || []).map(r => r.month))].slice(0, 40),
    }, 404)
  }

  const sm = crm.summary || {}
  const fbReps = reps.filter(r => r.source === 'facebook')
  const gReps = reps.filter(r => r.source && r.source.startsWith('google'))

  // ---- ad-level core metrics: join ad platform rows (spend/impr/clicks) with CRM outcomes ----
  const ads = new Map()
  const keyOf = (p, c, as, ad) => [p, rtl(c), rtl(as), norm(ad)].join('')
  const ensure = (p, c, as, ad) => {
    const k = keyOf(p, c, as, ad)
    if (!ads.has(k)) ads.set(k, {
      platform: p, campaign: rtl(c) || null, adset: rtl(as) || null, ad: norm(ad) || null,
      spend: 0, impressions: 0, clicks: 0, platform_leads: 0,
      leads: 0, meetings_scheduled: 0, meetings_completed: 0, registrations: 0, contracts: 0,
    })
    return ads.get(k)
  }
  const addPlatformRows = (repList, plat) => {
    repList.forEach(r => (r.data || []).forEach(row => {
      const a = ensure(plat, row.campaign, row.adSet || row.adset, row.adName || row.name)
      a.spend += n(row.spend); a.impressions += n(row.impressions); a.clicks += n(row.clicks); a.platform_leads += n(row.leads)
    }))
  }
  if (platform === 'meta' || platform === 'all') addPlatformRows(fbReps, 'meta')
  if (platform === 'google' || platform === 'all') addPlatformRows(gReps, 'google')
  ;(sm.adBreakdown || []).forEach(node => {
    const plat = platformOf(node)
    if (!plat) return
    if (platform !== 'all' && plat !== platform) return
    const a = ensure(plat, node.campaign, node.adset, node.ad)
    a.leads += n(node.leads); a.meetings_scheduled += n(node.meetings)
    a.meetings_completed += n(node.meetingsCompleted); a.registrations += n(node.registrations); a.contracts += n(node.contracts)
  })

  // ---- roll up to requested granularity ----
  const groupKey = (a) => granularity === 'campaign' ? [a.platform, a.campaign].join('')
    : granularity === 'adset' ? [a.platform, a.campaign, a.adset].join('')
      : [a.platform, a.campaign, a.adset, a.ad].join('')
  const grouped = new Map()
  for (const a of ads.values()) {
    const gk = groupKey(a)
    let g = grouped.get(gk)
    if (!g) {
      g = { platform: a.platform, campaign: a.campaign, adset: granularity === 'campaign' ? undefined : a.adset, ad: granularity === 'ad' ? a.ad : undefined,
        spend: 0, impressions: 0, clicks: 0, platform_leads: 0, leads: 0, meetings_scheduled: 0, meetings_completed: 0, registrations: 0, contracts: 0 }
      grouped.set(gk, g)
    }
    for (const f of ['spend', 'impressions', 'clicks', 'platform_leads', 'leads', 'meetings_scheduled', 'meetings_completed', 'registrations', 'contracts']) g[f] += a[f]
  }
  const rows = [...grouped.values()].map(g => {
    const has = g.spend || g.impressions || g.clicks || g.leads
    return {
      platform: g.platform,
      campaign: g.campaign,
      ...(granularity !== 'campaign' ? { adset: g.adset || null } : {}),
      ...(granularity === 'ad' ? { ad: g.ad || null } : {}),
      spend: has ? round2(g.spend) : null,
      impressions: g.impressions || null,
      clicks: g.clicks || null,
      leads: g.leads || null,
      platform_leads: g.platform_leads || null,
      cpl: round2(ratio(g.spend, g.leads)),
      meetings_scheduled: g.meetings_scheduled || null,
      meetings_completed: g.meetings_completed || null,
      cost_per_meeting_completed: round2(ratio(g.spend, g.meetings_completed)),
      meeting_completion_rate: round2(ratio(g.meetings_completed, g.leads) == null ? null : ratio(g.meetings_completed, g.leads) * 100),
      registrations: { count: g.registrations || null, value: null },
      contracts: { count: g.contracts || null, value: null },
      cost_per_contract: round2(ratio(g.spend, g.contracts)),
    }
  }).sort((a, b) => (b.spend || 0) - (a.spend || 0) || (b.leads || 0) - (a.leads || 0))

  // ---- client/period-level segments ----
  const repRows = (sm.crmRepRows || []).filter(r => !r.contractOnly)
  const countBy = (arr, get, split) => {
    const out = {}
    for (const r of arr) {
      let v = get(r); if (!v) continue
      const parts = split ? String(v).split(/\s*[,;/|]\s*/) : [String(v)]
      for (let p of parts) { p = decode(p.trim()); if (p) out[p] = (out[p] || 0) + 1 }
    }
    return Object.keys(out).length ? out : null
  }
  const hourArr = (a) => Array.isArray(a) ? a.map((v, h) => ({ hour: h, count: n(typeof v === 'object' ? (v.count ?? v.leads ?? v.total) : v) })).filter(x => x.count) : null
  const demoOf = (reps2, kind) => {
    const out = {}
    reps2.forEach(r => { const d = ((r.summary || {}).demographics || {})[kind] || {}; for (const k in d) out[k] = (out[k] || 0) + n(d[k].leads) })
    return Object.keys(out).length ? out : null
  }
  const rt = sm.responseTimeStats || {}
  const segments = {
    objections: countBy(repRows, r => r.objections, true),
    cities: countBy(repRows, r => r.address, false),
    housing_status: countBy(repRows, r => r.livingStatus, false),
    property_type: countBy(repRows, r => r.propertyType, true),
    lead_hours: hourArr(sm.hourlyLeadStats),
    meeting_hours: hourArr(sm.hourlyApptStats),
    day_of_week: sm.dayOfWeekStats || null,
    response_time: rt.avgMinutes != null ? { avg_minutes: round2(n(rt.avgMinutes)), total_leads: rt.totalLids ?? null, buckets: rt.buckets || null } : null,
    age_breakdown: demoOf(fbReps.concat(gReps), 'ages'),
    gender_breakdown: demoOf(fbReps.concat(gReps), 'genders'),
    crm_sources: sm.sources ? Object.entries(sm.sources).map(([source, s]) => ({
      source, leads: n(s.totalLeads) || null, relevant: n(s.relevantLeads) || null,
      meetings_scheduled: n(s.meetingsScheduled) || null, meetings_completed: n(s.meetingsCompleted) || null,
      registrations: n(s.registrations) || null, registrations_value: n(s.registrationValue) || null,
      contracts: n(s.contracts) || null, contracts_value: n(s.contractValue) || null,
    })).sort((a, b) => (b.leads || 0) - (a.leads || 0)) : null,
    top_ads: rows.filter(r => r.ad).slice(0, 10),
  }

  // ---- client/period totals (with values, which per-ad lacks) ----
  const totals = {
    leads: n(sm.totalLeads) || null,
    relevant_leads: n(sm.relevantLeads) || null,
    meetings_scheduled: n(sm.meetingsScheduled) || null,
    meetings_completed: n(sm.meetingsCompleted) || null,
    registrations: n(sm.registrations) || null,
    registrations_value: n(sm.registrationValue) || null,
    contracts: n(sm.contracts) || null,
    contracts_value: n(sm.contractValue) || null,
    meeting_completion_rate: round2(ratio(n(sm.meetingsCompleted), n(sm.totalLeads)) == null ? null : ratio(n(sm.meetingsCompleted), n(sm.totalLeads)) * 100),
  }

  return J({
    meta: {
      client_slug: clientSlug, client: client.name, project: projectSlug,
      from, to, granularity, platform,
      timezone: 'Asia/Jerusalem', currency: 'ILS',
      generated_at: new Date().toISOString(),
      schema_version: (sm.schemaVersion ?? null),
      notes: 'Aggregates only, no PII. Per-ad registration/contract VALUE is unavailable (see totals). Ad join is by normalized ad name; untagged CRM leads roll into a null-ad row.',
    },
    totals,
    metrics: rows,
    segments,
  })
}
