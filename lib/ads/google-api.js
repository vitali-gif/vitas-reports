/**
 * lib/ads/google-api.js — קריאות בסיס ל-Google Ads API, משותפות ל-google/fetch (הדוחות
 * השמורים) ול-ads/daily-sync (העובדות היומיות). הועברו מ-app/api/google/fetch/route.js
 * כמו שהן (שלב 2 של docs/daily-ranges-plan.md).
 */
// v22 יוצאת משימוש ב-7.10.2026 (מייל מגוגל, 17.9). v25.1 שוחררה ב-19.8.2026; הנתיב ב-URL הוא
// הגרסה הראשית (v25). כל השדות שאנחנו שואלים — ad_group_ad + segments.date, campaign.advertising_channel_type,
// asset_group / asset_group_asset, metrics.cost_micros/impressions/clicks/conversions — יציבים בין v22 ל-v25.
// אפשר לדרוס דרך GOOGLE_ADS_API_VERSION ב-Vercel בלי פריסה.
export const GOOGLE_ADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v25'

export function num(v) {
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
export function credsFor(customerId) {
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
export async function getAccessToken(creds) {
  const c = creds || credsFor(null)
  if (!c.refreshToken) throw new Error('missing refresh token')
  const hit = _atCache.get(c.refreshToken)
  if (hit && hit.exp > Date.now()) return hit.token
  const token = await mintAccessToken(c)
  _atCache.set(c.refreshToken, { token, exp: Date.now() + 50 * 60 * 1000 })
  return token
}

export async function mintAccessToken(c) {
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
export async function gaqlSearch(accessToken, customerId, query, opts = {}) {
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
  let pages = 0
  // ⚠️ התקרה זורקת ולא עוצרת בשקט — אותה סיבה כמו ב-metaFetchAll: syncOne מוחק את
  // הטווח לפני הכתיבה, ולכן תשובה חלקית שמתחזה לשלמה מוחקת ימים. ראו מיגרציה 021.
  const maxPages = 500
  for (;;) {
    if (pages >= maxPages) {
      throw new Error(`Google Ads pagination exceeded ${maxPages} pages (${allRows.length} rows so far) — refusing to return partial data`)
    }
    const body = { query }
    if (nextPageToken) body.pageToken = nextPageToken
    const res = await fetch(
      `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:search`,
      { method: 'POST', headers, body: JSON.stringify(body), ...(opts.signal ? { signal: opts.signal } : {}) }
    )
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`Google Ads API ${res.status}: ${txt.slice(0, 2000)}`)
    }
    const json = await res.json()
    if (Array.isArray(json.results)) allRows.push(...json.results)
    nextPageToken = json.nextPageToken || null
    if (!nextPageToken) break
    pages++
  }
  return allRows
}

/** טקסט המודעה מתוך אובייקט ad של GAQL (טקסטואלית, מורחבת, רספונסיבית, תצוגה). */
export function extractAdText(ad) {
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

/** כל מזהי הלקוחות המוגדרים (legacy יחיד + רשימה), בלי מקפים ובלי כפילויות. */
export function googleCustomerIds() {
  return [...new Set([
    ...(process.env.GOOGLE_ADS_CUSTOMER_ID || '').split(','),
    ...(process.env.GOOGLE_ADS_CUSTOMER_IDS || '').split(','),
  ].map((s) => s.trim().replace(/-/g, '')).filter(Boolean))]
}
