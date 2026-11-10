/**
 * lib/ads/tiktok-daily.js — שורות יומיות של TikTok לטבלת ad_daily (source = 'tiktok').
 * ויטלי, 10.11: קמפיין A/B של אקספו חיפה (דף נחיתה מול טופס מיידי).
 *
 * רמת מודעה × יום (AUCTION_AD + stat_time_day). בלי גיל/מגדר — TikTok לא מחזיר אותם יחד עם יום.
 * לידים = `result`: התוצאה לפי יעד האופטימיזציה של כל קמפיין — בקמפיין A זה Submit form של הפיקסל
 * בדף הנחיתה, בקמפיין B זה הטופס המיידי (onsite_form). כך שני הקמפיינים נספרים באותה יחידה.
 * Reach ברמת מודעה×יום חוזר 0 מ-TikTok, ולכן לא נשמר.
 */
import { tiktokGet } from './tiktok-api.js'

const METRICS = ['campaign_name', 'adgroup_name', 'ad_name', 'spend', 'impressions', 'clicks', 'result']
const PAGE_SIZE = 1000
const MAX_PAGES = 20

/** ENABLE/DISABLE של TikTok → הערכים שהדשבורד מכיר (ACTIVE / PAUSED, כמו ב-Meta). */
const STATUS = { ENABLE: 'ACTIVE', DISABLE: 'PAUSED', FROZEN: 'PAUSED' }

/**
 * סטטוס ומזהים לכל מודעה, קבוצה וקמפיין (ויטלי, 10.11: בלי זה כל הקמפיינים הוצגו "מכובה").
 * בכשל — מפות ריקות: המספרים נשמרים גם בלי סטטוס, ולא מפילים את המשיכה בגלל תצוגה.
 */
export async function tiktokStatuses(advertiserId, token, f) {
  const out = { ads: new Map(), adgroups: new Map(), campaigns: new Map(), error: null }
  const list = async (path, fields, put) => {
    for (let page = 1, total = 1; page <= total && page <= MAX_PAGES; page++) {
      const d = await tiktokGet(path, { advertiser_id: String(advertiserId), fields, page, page_size: PAGE_SIZE }, token, f)
      for (const x of d.list || []) put(x)
      total = Number(d.page_info?.total_page) || 1
    }
  }
  try {
    await Promise.all([
      list('ad/get/', ['ad_id', 'adgroup_id', 'campaign_id', 'operation_status'], x => out.ads.set(String(x.ad_id), x)),
      list('adgroup/get/', ['adgroup_id', 'operation_status'], x => out.adgroups.set(String(x.adgroup_id), x)),
      list('campaign/get/', ['campaign_id', 'operation_status'], x => out.campaigns.set(String(x.campaign_id), x)),
    ])
  } catch (e) { out.error = String(e?.message || e).slice(0, 200) }
  return out
}

/** @returns {Promise<{rows: object[], diag: object}>} */
export async function fetchTikTokDaily(advertiserId, since, until, { signal, token = process.env.TIKTOK_ACCESS_TOKEN, fetchImpl = fetch } = {}) {
  if (!token) throw new Error('TIKTOK_ACCESS_TOKEN missing')
  const f = signal ? (url, init) => fetchImpl(url, { ...init, signal }) : fetchImpl
  const rows = []
  const st = await tiktokStatuses(advertiserId, token, f)
  let page = 1, totalPage = 1
  do {
    const d = await tiktokGet('report/integrated/get/', {
      advertiser_id: String(advertiserId), report_type: 'BASIC', data_level: 'AUCTION_AD',
      dimensions: ['ad_id', 'stat_time_day'], metrics: METRICS,
      start_date: since, end_date: until, page, page_size: PAGE_SIZE,
    }, token, f)
    for (const r of d.list || []) {
      const m = r.metrics || {}, dim = r.dimensions || {}
      const spend = Number(m.spend) || 0, impressions = Number(m.impressions) || 0, clicks = Number(m.clicks) || 0, leads = Number(m.result) || 0
      if (!spend && !impressions && !clicks && !leads) continue
      const adId = String(dim.ad_id || '')
      const ad = st.ads.get(adId) || {}
      const campaignId = String(ad.campaign_id || ''), adsetId = String(ad.adgroup_id || '')
      rows.push({
        source: 'tiktok', account: String(advertiserId), day: String(dim.stat_time_day || '').slice(0, 10),
        campaign_id: campaignId, campaign: m.campaign_name || '', adset_id: adsetId, adset: m.adgroup_name || '', ad_id: adId, ad: m.ad_name || '',
        spend, impressions, clicks, leads,
        campaign_status: STATUS[st.campaigns.get(campaignId)?.operation_status] || '',
        adset_status: STATUS[st.adgroups.get(adsetId)?.operation_status] || '',
        ad_status: STATUS[ad.operation_status] || '',
      })
    }
    totalPage = Number(d.page_info?.total_page) || 1
    page++
    if (page > MAX_PAGES && page <= totalPage) throw new Error(`TikTok: more than ${MAX_PAGES} pages`)
  } while (page <= totalPage)
  return { rows, diag: { pages: page - 1, statuses: st.error || st.ads.size } }
}
