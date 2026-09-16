/**
 * lib/ads/meta-daily.js — עובדות יומיות מ-Meta לחשבון וטווח: אותה קריאת insights כמו
 * ב-meta/fetch (level=ad, breakdowns=age,gender), רק עם time_increment=1 כדי לקבל
 * שורה לכל יום. שלב 2 של docs/daily-ranges-plan.md.
 *
 * הסטטוסים (קמפיין/סדרה/מודעה) וטקסט המודעות הפעילות הם תמונת מצב חיה — נשלפים
 * בקריאות קלות ונדרסים בכל ריצה.
 */
import { META_GRAPH_VERSION, num, extractLeads, metaFetchAll, metaTokenFor } from './meta-api.js'

const FIELDS = [
  'campaign_name', 'campaign_id', 'adset_name', 'adset_id', 'ad_name', 'ad_id',
  'spend', 'impressions', 'reach', 'clicks', 'inline_link_clicks', 'actions',
].join(',')

async function statusMaps(accountId, token) {
  const campaignStatusById = {}, adSetStatusById = {}, adStatusById = {}, adBodyById = {}
  const base = `https://graph.facebook.com/${META_GRAPH_VERSION}/act_${accountId}`
  const [cs, as, ads] = await Promise.allSettled([
    metaFetchAll(`${base}/campaigns?fields=id,effective_status,status&limit=500`, token),
    metaFetchAll(`${base}/adsets?fields=id,effective_status,status&limit=500`, token),
    // מודעות פעילות בלבד, עם גוף המודעה — אותו סינון כמו ב-meta/fetch, כי creative{} יקר.
    metaFetchAll(`${base}/ads?fields=id,effective_status,status,creative{body,object_story_spec}&effective_status=${encodeURIComponent(JSON.stringify(['ACTIVE']))}&limit=50`, token),
  ])
  if (cs.status === 'fulfilled') for (const c of cs.value) campaignStatusById[c.id] = c.effective_status || c.status || ''
  if (as.status === 'fulfilled') for (const a of as.value) adSetStatusById[a.id] = a.effective_status || a.status || ''
  if (ads.status === 'fulfilled') for (const ad of ads.value) {
    adStatusById[ad.id] = ad.effective_status || ad.status || ''
    const cr = ad.creative || {}
    const spec = cr.object_story_spec || {}
    adBodyById[ad.id] = cr.body || spec.link_data?.message || spec.video_data?.message || spec.photo_data?.message || ''
  }
  return { campaignStatusById, adSetStatusById, adStatusById, adBodyById, errors: [cs, as, ads].filter(x => x.status === 'rejected').map(x => String(x.reason?.message || x.reason)) }
}

/**
 * @returns {Promise<{rows: object[], diag: object}>} שורות בצורת ad_daily (source='facebook')
 */
export async function fetchMetaDaily(accountId, since, until) {
  const token = metaTokenFor(accountId)
  if (!token) throw new Error(`no Meta token for account ${accountId}`)
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }))
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/act_${accountId}/insights?level=ad&breakdowns=age,gender&fields=${FIELDS}&time_range=${timeRange}&time_increment=1&use_unified_attribution_setting=true&limit=500`
  const [insights, maps] = await Promise.all([metaFetchAll(url, token), statusMaps(accountId, token)])
  const rows = insights.map(r => ({
    source: 'facebook', account: accountId, day: r.date_start,
    campaign_id: r.campaign_id || '', campaign: r.campaign_name || '',
    adset_id: r.adset_id || '', adset: r.adset_name || '',
    ad_id: r.ad_id || '', ad: r.ad_name || '',
    age: r.age || '', gender: r.gender || '',
    ad_text: r.ad_id ? (maps.adBodyById[r.ad_id] || '') : '',
    spend: num(r.spend), impressions: num(r.impressions), reach: num(r.reach),
    clicks: num(r.inline_link_clicks),   // link clicks only — matches Ads Manager 'Link clicks' (as in meta/fetch)
    leads: extractLeads(r.actions),
    campaign_status: r.campaign_id ? (maps.campaignStatusById[r.campaign_id] || '') : '',
    adset_status: r.adset_id ? (maps.adSetStatusById[r.adset_id] || '') : '',
    ad_status: r.ad_id ? (maps.adStatusById[r.ad_id] || '') : '',
  }))
  return { rows, diag: { account: accountId, since, until, insightRows: insights.length, statusErrors: maps.errors } }
}

/**
 * Reach אמיתי לטווח (משתמשים ייחודיים) — קריאה קלה אחת ברמת החשבון, עם סינון אופציונלי
 * לפי שם קמפיין (הניתוב של פרויקט רגיל). מחזיר null אם נכשל או חרג מהזמן.
 */
export async function fetchMetaRangeReach(accountId, since, until, { campaignContains = null, timeoutMs = 4000 } = {}) {
  const token = metaTokenFor(accountId)
  if (!token) return null
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }))
  let url = `https://graph.facebook.com/${META_GRAPH_VERSION}/act_${accountId}/insights?level=account&fields=reach,impressions&time_range=${timeRange}&use_unified_attribution_setting=true`
  if (campaignContains) url += `&filtering=${encodeURIComponent(JSON.stringify([{ field: 'campaign.name', operator: 'CONTAIN', value: campaignContains }]))}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${url}&access_token=${encodeURIComponent(token)}`, { signal: ctrl.signal })
    if (!res.ok) return null
    const json = await res.json()
    const row = Array.isArray(json.data) ? json.data[0] : null
    return row ? { reach: num(row.reach), impressions: num(row.impressions) } : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
