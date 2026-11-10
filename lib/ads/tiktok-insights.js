/**
 * lib/ads/tiktok-insights.js — נתונים נוספים לטאב TikTok (ויטלי, 10.11: "תעשה את כולם ואז נמחק"):
 *   adStats  — לכל מודעה לתקופה: צפיות (2/6 שניות, 25/50/75/100%), זמן צפייה, מעורבות, reach.
 *   account  — reach ו-frequency של החשבון לתקופה (לא ניתן לחיבור מהימים).
 *   audience — פילוח לפי מגדר, גיל, אזור ומערכת הפעלה (דוח AUDIENCE).
 *   media    — לכל מודעה: תמונת שער / תצוגה מקדימה של הסרטון, או מזהה הפוסט ל-Spark.
 *
 * נקרא מ-lib/ads/tiktok-reports.js לכל תקופה מוכנה. כל חלק עצמאי: כשל באחד לא מפיל את האחרים,
 * ומדד שהחשבון לא תומך בו נופל לרשימה מצומצמת (TikTok דוחה את כל הבקשה על מדד לא מוכר).
 */
import { tiktokGet } from './tiktok-api.js'

const VIDEO = ['video_play_actions', 'video_watched_2s', 'video_watched_6s', 'video_views_p25', 'video_views_p50', 'video_views_p75', 'video_views_p100', 'average_video_play']
const ENGAGE = ['likes', 'comments', 'shares', 'follows', 'profile_visits']
const CORE = ['ad_name', 'campaign_name', 'adgroup_name', 'spend', 'impressions', 'clicks', 'result', 'reach']
// אזורים בישראל (GeoNames, כפי ש-TikTok מחזיר ב-province_id)
const IL_DISTRICTS = { 293198: 'מחוז ירושלים', 293396: 'מחוז תל אביב', 294800: 'מחוז חיפה', 294824: 'מחוז הצפון', 294904: 'מחוז המרכז', 294952: 'מחוז הדרום', 6255147: 'יהודה ושומרון' }
const N = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

async function report(token, f, params, metricSets) {
  let lastErr = null
  for (const metrics of metricSets) {
    try {
      const out = []
      for (let page = 1, total = 1; page <= total && page <= 10; page++) {
        const d = await tiktokGet('report/integrated/get/', { ...params, metrics, page, page_size: 1000 }, token, f)
        out.push(...(d.list || []))
        total = Number(d.page_info?.total_page) || 1
      }
      return { rows: out, metrics }
    } catch (e) { lastErr = e }
  }
  throw lastErr
}

/** סטטיסטיקה לכל מודעה בתקופה. */
export async function tiktokAdStats(advertiserId, since, until, token, f = fetch) {
  const { rows, metrics } = await report(token, f,
    { advertiser_id: String(advertiserId), report_type: 'BASIC', data_level: 'AUCTION_AD', dimensions: ['ad_id'], start_date: since, end_date: until },
    [[...CORE, ...VIDEO, ...ENGAGE], [...CORE, ...VIDEO], CORE])
  const keys = metrics.filter(k => !['ad_name', 'campaign_name', 'adgroup_name'].includes(k))
  return rows.map(r => {
    const m = r.metrics || {}
    const o = { adId: String(r.dimensions?.ad_id || ''), adName: m.ad_name || '', campaign: m.campaign_name || '', adSet: m.adgroup_name || '' }
    for (const k of keys) o[k] = N(m[k])
    o.leads = o.result; delete o.result
    return o
  }).filter(o => o.spend > 0 || o.impressions > 0)
}

/** סינון לקמפיינים מסוימים (TikTok: filtering כמחרוזת JSON). null = בלי סינון. */
const campFilter = (ids) => ids ? [{ field_name: 'campaign_ids', filter_type: 'IN', filter_value: JSON.stringify(ids) }] : null
/** דוח עם סינון; אם TikTok דוחה את הסינון — בלעדיו, ומסמנים (כדי לדעת שהמספר כולל קמפיינים אחרים). */
async function filtered(token, f, params, metricSets, ids, flags) {
  if (!ids) return report(token, f, params, metricSets)
  try { return await report(token, f, { ...params, filtering: campFilter(ids) }, metricSets) }
  catch (e) { flags.unfiltered = String(e?.message || e).slice(0, 120); return report(token, f, params, metricSets) }
}

/** reach ו-frequency לחשבון (או לקמפיינים שב-ids) בתקופה. */
export async function tiktokAccountReach(advertiserId, since, until, token, f = fetch, ids = null, flags = {}) {
  const { rows } = await filtered(token, f,
    { advertiser_id: String(advertiserId), report_type: 'BASIC', data_level: 'AUCTION_ADVERTISER', dimensions: ['advertiser_id'], start_date: since, end_date: until },
    [['reach', 'frequency', 'impressions']], ids, flags)
  const m = rows[0]?.metrics || {}
  return { reach: N(m.reach), frequency: N(m.frequency), impressions: N(m.impressions) }
}

/** פילוח קהל: dim אחד מ-gender / age / province_id / platform. */
export async function tiktokAudience(advertiserId, since, until, dim, token, f = fetch, ids = null, flags = {}) {
  const base = { advertiser_id: String(advertiserId), report_type: 'AUDIENCE', data_level: 'AUCTION_ADVERTISER', start_date: since, end_date: until }
  const M = [['spend', 'impressions', 'clicks', 'conversion'], ['spend', 'impressions', 'clicks']]
  let res
  try { res = await filtered(token, f, { ...base, dimensions: [dim] }, M, ids, flags) }
  catch { res = await filtered(token, f, { ...base, dimensions: ['advertiser_id', dim] }, M, ids, flags) }
  return res.rows.map(r => ({ key: String(r.dimensions?.[dim] ?? ''), ...(dim === 'province_id' ? { name: IL_DISTRICTS[String(r.dimensions?.[dim])] || '' } : {}), spend: N(r.metrics?.spend), impressions: N(r.metrics?.impressions), clicks: N(r.metrics?.clicks), leads: N(r.metrics?.conversion) }))
    .filter(x => x.key && (x.spend > 0 || x.impressions > 0))
    .sort((a, b) => b.spend - a.spend)
}

/** תמונות ותצוגות: video_id → file/video/ad/info; מודעת Spark בלי video_id → מזהה הפוסט (tiktok_item_id). */
export async function tiktokAdMedia(advertiserId, token, f = fetch) {
  const ads = []
  for (let page = 1, total = 1; page <= total && page <= 10; page++) {
    const d = await tiktokGet('ad/get/', { advertiser_id: String(advertiserId), fields: ['ad_id', 'ad_name', 'video_id', 'tiktok_item_id', 'image_ids'], page, page_size: 1000 }, token, f)
    ads.push(...(d.list || []))
    total = Number(d.page_info?.total_page) || 1
  }
  const videoIds = [...new Set(ads.map(a => a.video_id).filter(Boolean))]
  const videos = new Map()
  for (let i = 0; i < videoIds.length; i += 60) {
    try {
      const d = await tiktokGet('file/video/ad/info/', { advertiser_id: String(advertiserId), video_ids: videoIds.slice(i, i + 60) }, token, f)
      for (const v of d.list || []) videos.set(String(v.video_id), v)
    } catch { /* בלי תמונה — הגלריה תציג את הפוסט */ }
  }
  const out = {}
  for (const a of ads) {
    const v = a.video_id ? videos.get(String(a.video_id)) : null
    out[String(a.ad_id)] = {
      cover: v?.video_cover_url || v?.poster_url || '',
      preview: v?.preview_url || '',
      itemId: a.tiktok_item_id ? String(a.tiktok_item_id) : '',
      duration: N(v?.duration),
    }
  }
  return out
}

/** הכל יחד לתקופה אחת. media מועבר מבחוץ (אחד לכל הריצה). */
/**
 * campaignMatch (10.11) — רק קמפיינים של הפרויקט (TIKTOK_ACCOUNTS[].any). כל הקמפיינים בחשבון מתאימים → בלי סינון.
 * הקהלים וה-reach מסוננים בצד של TikTok לפי מזהי הקמפיינים; המודעות — כאן, לפי שם הקמפיין.
 */
export async function tiktokInsights(advertiserId, since, until, { token = process.env.TIKTOK_ACCESS_TOKEN, fetchImpl = fetch, campaignMatch = null } = {}) {
  const errors = {}, flags = {}
  const safe = async (k, fn) => { try { return await fn() } catch (e) { errors[k] = String(e?.message || e).slice(0, 160); return null } }
  let ids = null
  if (campaignMatch) {
    const camps = await safe('campaigns', async () => {
      const out = []
      for (let page = 1, total = 1; page <= total && page <= 10; page++) {
        const d = await tiktokGet('campaign/get/', { advertiser_id: String(advertiserId), fields: ['campaign_id', 'campaign_name'], page, page_size: 1000 }, token, fetchImpl)
        out.push(...(d.list || [])); total = Number(d.page_info?.total_page) || 1
      }
      return out
    })
    if (camps) { const mine = camps.filter(c => campaignMatch(c.campaign_name)); if (mine.length < camps.length) ids = mine.map(c => String(c.campaign_id)) }
  }
  if (ids && !ids.length) return { since, until, fetchedAt: new Date().toISOString(), adStats: [], account: null, audience: { gender: [], age: [], region: [], platform: [] } }
  const [adStats, account, gender, age, region, platform] = await Promise.all([
    safe('adStats', () => tiktokAdStats(advertiserId, since, until, token, fetchImpl)),
    safe('account', () => tiktokAccountReach(advertiserId, since, until, token, fetchImpl, ids, flags)),
    safe('gender', () => tiktokAudience(advertiserId, since, until, 'gender', token, fetchImpl, ids, flags)),
    safe('age', () => tiktokAudience(advertiserId, since, until, 'age', token, fetchImpl, ids, flags)),
    safe('region', () => tiktokAudience(advertiserId, since, until, 'province_id', token, fetchImpl, ids, flags)),
    safe('platform', () => tiktokAudience(advertiserId, since, until, 'platform', token, fetchImpl, ids, flags)),
  ])
  if (flags.unfiltered) errors.unfiltered = flags.unfiltered
  return {
    since, until, fetchedAt: new Date().toISOString(),
    adStats: (adStats || []).filter(s => !campaignMatch || campaignMatch(s.campaign)), account: account || null,
    ...(ids ? { campaignIds: ids } : {}),
    audience: { gender: gender || [], age: age || [], region: region || [], platform: platform || [] },
    ...(Object.keys(errors).length ? { errors } : {}),
  }
}
