/**
 * POST /api/admin/zoho-token { code } — ממיר קוד חד-פעמי של Zoho (Self Client → Generate Code)
 * ל-Refresh Token חדש, עם ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET שכבר ב-Vercel (7.11: ה-Refresh Token
 * הוחלף בטעות בקוד שפג, והמשיכה מ-Zoho נעצרה). אדמין בלבד.
 *
 * ה-Refresh Token חוזר רק בתשובה למסך של האדמין (app/admin/zoho-token) — לא נשמר בשום מקום ולא נרשם
 * בלוג. משם ויטלי מעתיק אותו ל-Vercel (Sensitive) ול-API.txt.
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/auth'

export const dynamic = 'force-dynamic'
const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } })
const TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token'

export async function POST(req) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({}))
  const code = String(body.code || '').trim()
  if (!/^1000\.[A-Za-z0-9.]{20,300}$/.test(code)) return J({ error: 'הקוד צריך להתחיל ב-1000. — להעתיק אותו שוב מ-Zoho' }, 400)
  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET) return J({ error: 'ZOHO_CLIENT_ID או ZOHO_CLIENT_SECRET חסרים ב-Vercel' }, 500)
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: process.env.ZOHO_CLIENT_ID, client_secret: process.env.ZOHO_CLIENT_SECRET, code }).toString(),
  }).catch(() => null)
  const j = res ? await res.json().catch(() => ({})) : {}
  if (!j.refresh_token) {
    const why = j.error === 'invalid_code' ? 'הקוד פג או כבר נוצל — לייצר קוד חדש ב-Zoho ולהדביק תוך 10 דקות'
      : j.error === 'invalid_client' ? 'ה-Client Secret ב-Vercel לא תואם ל-Client ID (או שהקוד נוצר ב-Client אחר)'
      : (j.error ? `Zoho: ${String(j.error).slice(0, 100)}` : 'Zoho לא ענה')
    return J({ error: why }, 400)
  }
  // בודקים שה-Refresh Token החדש באמת עובד לפני שמחזירים אותו
  const chk = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: process.env.ZOHO_CLIENT_ID, client_secret: process.env.ZOHO_CLIENT_SECRET, refresh_token: j.refresh_token }).toString(),
  }).then(r => r.json()).catch(() => ({}))
  return J({ refreshToken: j.refresh_token, scope: j.scope || null, works: !!chk.access_token, apiDomain: j.api_domain || null })
}
