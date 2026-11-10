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

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
/** קריאה עם המתנה וניסיון חוזר כש-TikTok עונה "QPS limit" (10 בקשות לשנייה לאפליקציה). */
async function get(path, params, token, f) {
  for (let i = 0; ; i++) {
    try { return await tiktokGet(path, params, token, f) }
    catch (e) { if (i < 3 && /qps|rate limit|too many/i.test(String(e?.message || e))) { await sleep(1200 * (i + 1)); continue } throw e }
  }
}

async function report(token, f, params, metricSets) {
  let lastErr = null
  for (const metrics of metricSets) {
    try {
      const out = []
      for (let page = 1, total = 1; page <= total && page <= 10; page++) {
        const d = await get('report/integrated/get/', { ...params, metrics, page, page_size: 1000 }, token, f)
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

/**
 * reach ו-frequency. בלי ids — לחשבון כולו. עם ids — לכל קמפיין בנפרד (AUCTION_CAMPAIGN) ומחוברים:
 * TikTok לא תומך בסינון campaign_ids בדוח (נבדק 10.11). חיבור reach בין קמפיינים מדויק כשהקהלים לא חופפים —
 * כך בניסוי A/B של אקספו (split test); אחרת זה גבול עליון.
 */
export async function tiktokAccountReach(advertiserId, since, until, token, f = fetch, ids = null) {
  if (!ids) {
    const { rows } = await report(token, f,
      { advertiser_id: String(advertiserId), report_type: 'BASIC', data_level: 'AUCTION_ADVERTISER', dimensions: ['advertiser_id'], start_date: since, end_date: until },
      [['reach', 'frequency', 'impressions']])
    const m = rows[0]?.metrics || {}
    return { reach: N(m.reach), frequency: N(m.frequency), impressions: N(m.impressions) }
  }
  const want = new Set(ids)
  const { rows } = await report(token, f,
    { advertiser_id: String(advertiserId), report_type: 'BASIC', data_level: 'AUCTION_CAMPAIGN', dimensions: ['campaign_id'], start_date: since, end_date: until },
    [['reach', 'impressions']])
  let reach = 0, impressions = 0
  for (const r of rows) if (want.has(String(r.dimensions?.campaign_id))) { reach += N(r.metrics?.reach); impressions += N(r.metrics?.impressions) }
  return { reach, frequency: reach > 0 ? Math.round((impressions / reach) * 100) / 100 : 0, impressions, summed: true }
}

/** פילוח קהל: dim אחד מ-gender / age / province_id / platform. */
// עם ids: דוח ברמת קמפיין (campaign_id × dim), מסננים כאן ומחברים לפי ערך — אותה סיבה כמו ב-reach.
export async function tiktokAudience(advertiserId, since, until, dim, token, f = fetch, ids = null) {
  const M = [['spend', 'impressions', 'clicks', 'conversion'], ['spend', 'impressions', 'clicks']]
  let rows
  if (ids) {
    const want = new Set(ids)
    rows = (await report(token, f, { advertiser_id: String(advertiserId), report_type: 'AUDIENCE', data_level: 'AUCTION_CAMPAIGN', dimensions: ['campaign_id', dim], start_date: since, end_date: until }, M)).rows
      .filter(r => want.has(String(r.dimensions?.campaign_id)))
  } else {
    const base = { advertiser_id: String(advertiserId), report_type: 'AUDIENCE', data_level: 'AUCTION_ADVERTISER', start_date: since, end_date: until }
    try { rows = (await report(token, f, { ...base, dimensions: [dim] }, M)).rows }
    catch { rows = (await report(token, f, { ...base, dimensions: ['advertiser_id', dim] }, M)).rows }
  }
  const by = new Map()
  for (const r of rows) {
    const key = String(r.dimensions?.[dim] ?? '')
    if (!key) continue
    const o = by.get(key) || { key, ...(dim === 'province_id' ? { name: IL_DISTRICTS[key] || '' } : {}), spend: 0, impressions: 0, clicks: 0, leads: 0 }
    o.spend += N(r.metrics?.spend); o.impressions += N(r.metrics?.impressions); o.clicks += N(r.metrics?.clicks); o.leads += N(r.metrics?.conversion)
    by.set(key, o)
  }
  return [...by.values()].filter(x => x.spend > 0 || x.impressions > 0).sort((a, b) => b.spend - a.spend)
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
  const errors = {}
  const safe = async (k, fn) => { try { return await fn() } catch (e) { errors[k] = String(e?.message || e).slice(0, 160); return null } }
  let ids = null
  if (campaignMatch) {
    const camps = await safe('campaigns', async () => {
      const out = []
      for (let page = 1, total = 1; page <= total && page <= 10; page++) {
        const d = await get('campaign/get/', { advertiser_id: String(advertiserId), fields: ['campaign_id', 'campaign_name'], page, page_size: 1000 }, token, fetchImpl)
        out.push(...(d.list || [])); total = Number(d.page_info?.total_page) || 1
      }
      return out
    })
    if (camps) { const mine = camps.filter(c => campaignMatch(c.campaign_name)); if (mine.length < camps.length) ids = mine.map(c => String(c.campaign_id)) }
  }
  if (ids && !ids.length) return { since, until, fetchedAt: new Date().toISOString(), adStats: [], account: null, audience: { gender: [], age: [], region: [], platform: [] } }
  // ברצף ולא במקביל: לאפליקציה תקרה של 10 בקשות לשנייה (10.11 — שישה במקביל × כמה תקופות עברו אותה)
  const adStats = await safe('adStats', () => tiktokAdStats(advertiserId, since, until, token, fetchImpl))
  const account = await safe('account', () => tiktokAccountReach(advertiserId, since, until, token, fetchImpl, ids))
  const gender = await safe('gender', () => tiktokAudience(advertiserId, since, until, 'gender', token, fetchImpl, ids))
  const age = await safe('age', () => tiktokAudience(advertiserId, since, until, 'age', token, fetchImpl, ids))
  const region = await safe('region', () => tiktokAudience(advertiserId, since, until, 'province_id', token, fetchImpl, ids))
  const platform = await safe('platform', () => tiktokAudience(advertiserId, since, until, 'platform', token, fetchImpl, ids))
  return {
    since, until, fetchedAt: new Date().toISOString(),
    adStats: (adStats || []).filter(s => !campaignMatch || campaignMatch(s.campaign)), account: account || null,
    ...(ids ? { campaignIds: ids } : {}),
    audience: { gender: gender || [], age: age || [], region: region || [], platform: platform || [] },
    ...(Object.keys(errors).length ? { errors } : {}),
  }
}
