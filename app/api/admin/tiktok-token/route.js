/**
 * /api/admin/tiktok-token — חיבור הדשבורד ל-TikTok (ויטלי, 9.11). אדמין בלבד.
 *   GET  → כתובת האישור של TikTok (app_id מ-Vercel, redirect = /admin/tiktok-token)
 *   POST { authCode } → מחליף לטוקן, בודק אותו (רשימת חשבונות + הוצאה של 7 ימים) ומחזיר אותו למסך.
 * הטוקן חוזר רק לאדמין במסך — לא נשמר ולא נרשם בלוג. ויטלי מעתיק אותו ל-Vercel (TIKTOK_ACCESS_TOKEN,
 * Sensitive) ול-API.txt. כמו /api/admin/zoho-token.
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/auth'
import { TIKTOK_AUTH_URL, tiktokExchangeCode, tiktokAdvertisers, tiktokDailySpend } from '../../../../lib/ads/tiktok-api.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } })
// trim: ערך שהודבק ב-Vercel עם רווח או שורה חדשה בסוף נדחה ע"י TikTok כ"secret incorrect" (9.11)
const creds = () => ({ appId: String(process.env.TIKTOK_APP_ID || '').trim(), secret: String(process.env.TIKTOK_APP_SECRET || '').trim() })
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d)

export async function GET(req) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.res
  const { appId, secret } = creds()
  if (!appId || !secret) return J({ error: 'TIKTOK_APP_ID או TIKTOK_APP_SECRET חסרים ב-Vercel' }, 500)
  const origin = new URL(req.url).origin
  const state = String(new URL(req.url).searchParams.get('state') || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 40)
  const url = `${TIKTOK_AUTH_URL}?${new URLSearchParams({ app_id: appId, state, redirect_uri: `${origin}/admin/tiktok-token` })}`
  return J({ url, hasToken: !!process.env.TIKTOK_ACCESS_TOKEN })
}

export async function POST(req) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.res
  const { appId, secret } = creds()
  if (!appId || !secret) return J({ error: 'TIKTOK_APP_ID או TIKTOK_APP_SECRET חסרים ב-Vercel' }, 500)
  const body = await req.json().catch(() => ({}))
  const authCode = String(body.authCode || '').trim()
  if (!/^[A-Za-z0-9_\-.]{10,200}$/.test(authCode)) return J({ error: 'קוד האישור חסר או לא תקין - לחזור על "חיבור ל-TikTok"' }, 400)
  let data
  try { data = await tiktokExchangeCode(authCode, { appId, secret }) }
  catch (e) { return J({ error: String(e.message || e).replace(/^TikTok: /, 'TikTok: ') + ' (קוד אישור תקף כשעה ולשימוש אחד)' }, 400) }
  const token = data.access_token
  if (!token) return J({ error: 'TikTok לא החזיר טוקן' }, 400)
  // בדיקה: אילו חשבונות הטוקן רואה, והוצאה של 7 הימים האחרונים בכל אחד
  let advertisers = []
  try { advertisers = await tiktokAdvertisers(token, { appId, secret }) }
  catch { advertisers = (data.advertiser_ids || []).map(id => ({ id: String(id), name: '' })) }
  const until = ymd(new Date()), since = ymd(new Date(Date.now() - 6 * 864e5))
  const checks = await Promise.all(advertisers.map(async a => {
    try { const rows = await tiktokDailySpend(token, a.id, since, until); return { ...a, ok: true, spend7d: Math.round(rows.reduce((s, r) => s + r.spend, 0)) } }
    catch (e) { return { ...a, ok: false, error: String(e.message || e).slice(0, 160) } }
  }))
  return J({ accessToken: token, scope: data.scope || null, advertisers: checks, since, until })
}
