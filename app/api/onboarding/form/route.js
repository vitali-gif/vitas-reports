/**
 * /api/onboarding/form — שאלון הקליטה ללקוח, צד האדמין (ויטלי, 7.11; מיגרציה 032).
 *   GET  ?projectId=…  → { form: { token, answers, updated_at, submitted_at, revoked } | null }
 *   POST { projectId }              → יוצר קישור (או מחזיר את הקיים) → { token }
 *   POST { projectId, revoke: true } → מבטל את הקישור (נוצר חדש בפעם הבאה)
 * הלקוח ממלא ב-/onboard/<token> (app/api/public/onboarding-form). requireAdmin.
 */
import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { adminClient, requireAdmin } from '../../../../lib/auth'

export const dynamic = 'force-dynamic'
const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } })
const MISSING = (e) => e && (/onboarding_forms/.test(e.message || '') || e.code === '42P01')

export async function GET(req) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.res
  const projectId = new URL(req.url).searchParams.get('projectId')
  if (!projectId) return J({ error: 'projectId required' }, 400)
  const { data, error } = await adminClient().from('onboarding_forms').select('token, answers, updated_at, submitted_at, revoked').eq('project_id', projectId).maybeSingle()
  if (MISSING(error)) return J({ form: null, ready: false })
  if (error) return J({ error: error.message }, 500)
  const form = data && !data.revoked ? data : null
  // קבצים שהלקוח העלה — קישורי הורדה חתומים לשעה
  let files = []
  const list = form?.answers?.assets_files || []
  if (list.length) {
    const { data: urls } = await adminClient().storage.from('onboarding-files').createSignedUrls(list.map(x => x.path), 3600)
    files = list.map((x, i) => ({ name: x.name, size: x.size, url: urls?.[i]?.signedUrl || null }))
  }
  // מיילים לגישה לדשבורד שהלקוח כתב בשאלון — מי כבר קיבל גישה, ומי עוד לא (הוספה בלחיצה מהחלון)
  let dashUsers = [], clientId = null
  const rows = (form?.answers?.dash_users || []).filter(r => r && /\S+@\S+\.\S+/.test(String(r.email || '')))
  if (rows.length) {
    const sb = adminClient()
    const [{ data: proj }, { data: acc }] = await Promise.all([
      sb.from('projects').select('client_id').eq('id', projectId).maybeSingle(),
      sb.from('client_access').select('email').eq('project_id', projectId),
    ])
    clientId = proj?.client_id || null
    const have = new Set((acc || []).map(x => String(x.email || '').toLowerCase()))
    dashUsers = rows.map(r => ({ name: r.name || '', email: String(r.email).trim().toLowerCase(), hasAccess: have.has(String(r.email).trim().toLowerCase()) }))
  }
  return J({ form, files, dashUsers, clientId, ready: true })
}

export async function POST(req) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  if (!b.projectId) return J({ error: 'projectId required' }, 400)
  const sb = adminClient()
  const { data: cur, error } = await sb.from('onboarding_forms').select('token, revoked').eq('project_id', b.projectId).maybeSingle()
  if (MISSING(error)) return J({ error: 'צריך להריץ את מיגרציה 032 (scripts/migrations/032_onboarding_form.sql)' }, 503)
  if (error) return J({ error: error.message }, 500)
  if (b.revoke) {
    if (cur) await sb.from('onboarding_forms').update({ revoked: true, updated_at: new Date().toISOString() }).eq('project_id', b.projectId)
    return J({ ok: true })
  }
  if (cur && !cur.revoked) return J({ token: cur.token })
  const token = randomBytes(24).toString('base64url')
  // קישור שבוטל — טוקן חדש, אבל התשובות שכבר מולאו נשארות
  const row = { project_id: b.projectId, token, revoked: false, created_by: gate.user?.email || null, updated_at: new Date().toISOString() }
  const { error: upErr } = cur ? await sb.from('onboarding_forms').update(row).eq('project_id', b.projectId) : await sb.from('onboarding_forms').insert(row)
  if (upErr) return J({ error: upErr.message }, 500)
  return J({ token })
}
