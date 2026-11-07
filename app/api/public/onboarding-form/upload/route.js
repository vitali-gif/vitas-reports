/**
 * POST /api/public/onboarding-form/upload { token, name, type, size } — קישור העלאה חתום לקובץ אחד בשאלון הקליטה
 * (7.11; מיגרציה 033). ההרשאה: הטוקן של השאלון. הקובץ נכנס לתיקייה של הפרויקט בדלי הפרטי onboarding-files;
 * הדפדפן מעלה ישירות ל-Storage עם הקישור החתום (uploadToSignedUrl), ואז שומר את הנתיב בתשובות.
 * עד 25MB, סוגי קבצים מוגבלים, הגבלת קצב.
 */
import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { adminClient } from '../../../../../lib/auth'
import { rateLimit, tooManyRequests } from '../../../../../lib/rate-limit'

export const dynamic = 'force-dynamic'
const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })
const BUCKET = 'onboarding-files'
const MAX = 25 * 1024 * 1024
const TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/
const EXT = /\.(jpe?g|png|webp|gif|svg|pdf|mp4|mov|zip|ai|psd|eps)$/i
const ipOf = (req) => String(req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'

export async function POST(req) {
  const b = await req.json().catch(() => ({}))
  const rl = await rateLimit('onboarding-upload', ipOf(req), 60, 3600)
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec)
  if (!TOKEN_RE.test(b.token || '')) return J({ error: 'הקישור לא תקין' }, 404)
  const name = String(b.name || '').slice(0, 150)
  if (!EXT.test(name)) return J({ error: `${name}: סוג קובץ לא נתמך (תמונה, PDF, סרטון, ZIP)` }, 400)
  if (!(Number(b.size) > 0) || Number(b.size) > MAX) return J({ error: `${name}: עד 25MB לקובץ` }, 400)
  const sb = adminClient()
  const { data: f } = await sb.from('onboarding_forms').select('project_id, revoked, answers').eq('token', b.token).maybeSingle()
  if (!f || f.revoked) return J({ error: 'הקישור לא תקין או שבוטל' }, 404)
  if ((f.answers?.assets_files || []).length >= 30) return J({ error: 'הגעתם ל-30 קבצים. אפשר לשלוח קישור לתיקייה.' }, 400)
  const safe = name.replace(/[^\w.\-֐-׿]+/g, '_').slice(-80)
  const path = `${f.project_id}/${Date.now()}-${randomBytes(4).toString('hex')}-${safe}`
  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error) return J({ error: /not found/i.test(error.message) ? 'ההעלאה עוד לא מוכנה (מיגרציה 033)' : 'ההעלאה נכשלה' }, 500)
  return J({ bucket: BUCKET, path: data.path || path, uploadToken: data.token })
}
