/**
 * lib/ads/tiktok-api.js — TikTok Marketing API (v1.3), קריאה בלבד (ויטלי, 9.11: קמפיין לאקספו בטיקטוק).
 *
 * חיבור: אפליקציית "Vitas Dashboard" ב-business-api.tiktok.com (מאושרת). ויטלי מאשר את חשבונות המודעות
 * דרך /admin/tiktok-token, והטוקן שחוזר נשמר ב-Vercel כ-TIKTOK_ACCESS_TOKEN (Sensitive). ה-Access-Token
 * נשלח בכותרת Access-Token (לא Authorization: Bearer). TIKTOK_APP_ID / TIKTOK_APP_SECRET — ב-Vercel.
 */
export const TIKTOK_BASE = 'https://business-api.tiktok.com/open_api/v1.3'
export const TIKTOK_AUTH_URL = 'https://business-api.tiktok.com/portal/auth'

/** קריאת GET ל-API. זורק על code !== 0 (TikTok מחזיר 200 גם על שגיאה). */
export async function tiktokGet(path, params, token, fetchImpl = fetch) {
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params || {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])))
  const res = await fetchImpl(`${TIKTOK_BASE}/${path.replace(/^\//, '')}?${qs}`, { headers: { 'Access-Token': token } })
  const j = await res.json().catch(() => ({}))
  if (j.code !== 0) throw new Error('TikTok: ' + String(j.message || `HTTP ${res.status}`).slice(0, 200))
  return j.data || {}
}

/** החלפת auth_code לטוקן (ארוך-טווח). מחזיר { access_token, advertiser_ids, scope }. */
export async function tiktokExchangeCode(authCode, { appId, secret }, fetchImpl = fetch) {
  const res = await fetchImpl(`${TIKTOK_BASE}/oauth2/access_token/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, secret, auth_code: authCode }),
  })
  const j = await res.json().catch(() => ({}))
  if (j.code !== 0) throw new Error('TikTok: ' + String(j.message || `HTTP ${res.status}`).slice(0, 200))
  return j.data || {}
}

/** שמות החשבונות שהטוקן רואה. */
export async function tiktokAdvertisers(token, { appId, secret }, fetchImpl = fetch) {
  const d = await tiktokGet('oauth2/advertiser/get/', { app_id: appId, secret }, token, fetchImpl)
  return (d.list || []).map(a => ({ id: String(a.advertiser_id), name: a.advertiser_name || '' }))
}

/** הוצאה לפי יום לחשבון (בדיקת חיבור). */
export async function tiktokDailySpend(token, advertiserId, since, until, fetchImpl = fetch) {
  const d = await tiktokGet('report/integrated/get/', {
    advertiser_id: String(advertiserId), report_type: 'BASIC', data_level: 'AUCTION_ADVERTISER',
    dimensions: ['stat_time_day'], metrics: ['spend', 'impressions', 'clicks'], start_date: since, end_date: until, page_size: 100,
  }, token, fetchImpl)
  return (d.list || []).map(r => ({ day: String(r.dimensions?.stat_time_day || '').slice(0, 10), spend: Number(r.metrics?.spend) || 0, impressions: Number(r.metrics?.impressions) || 0, clicks: Number(r.metrics?.clicks) || 0 }))
}

/**
 * אילו חשבונות TikTok נמשכים, ולאיזה פרויקט (ויטלי, 9.11: "תחבר רק את אלפא כרגע").
 * הטוקן רואה גם את בי-קיור לייזר ואת Geshem Holdings — הם לא נמשכים עד שנוסיף אותם כאן.
 * `any` (10.11): רק קמפיינים שהשם שלהם מכיל אחת המילים — באותו חשבון רץ גם "Alpha-Followers" (עוקבים,
 * לא לידים: ה-result שלו הוא עוקבים), ואותו כלל כמו ב-Meta: "קמפיינים שמכילים את המילה EXPO".
 * `match` הוא תת-מחרוזת של שם הפרויקט ב-Supabase. `since` — היום הראשון שה-backfill היומי מושך (החשבון נפתח בנובמבר).
 */
export const TIKTOK_ACCOUNTS = [
  { advertiserId: '7702455288577998900', label: 'אלפא יזמות', match: 'אקספו חיפה', since: '2026-11-01', any: ['expo'] },
]
/** האם שם הקמפיין שייך לחשבון לפי `any` (בלי `any` — כל הקמפיינים). */
export const tiktokCampaignMatches = (acct, campaign) => !acct?.any || acct.any.some(k => String(campaign || '').toLowerCase().includes(k.toLowerCase()))
export const tiktokAccountsFor = (projectName) => {
  const n = String(projectName || '').toLowerCase().trim()
  return TIKTOK_ACCOUNTS.filter(a => n.includes(a.match.toLowerCase()))
}
