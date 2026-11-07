/**
 * /api/public/onboarding-form — שאלון הקליטה, צד הלקוח (ויטלי, 7.11; מיגרציה 032).
 * ציבורי בכוונה: ההרשאה היא הטוקן שבקישור (24 בתים אקראיים), שהאדמין יוצר ב-/api/onboarding/form.
 * הלקוח לא צריך משתמש כדי למלא. קישור שבוטל (revoked) לא נפתח. הגבלת קצב לכל טוקן ו-IP.
 *
 *   GET  ?token=…                 → { project, answers, submitted_at }
 *   POST { token, answers, submit? } → שומר (רק שאלות מוכרות — cleanAnswers), ומסמן שלבים ב"קליטת לקוחות"
 *        (stepsFromAnswers) — רק שלב שלא סומן ידנית: אין רשומה, או todo, או שסומן קודם מהשאלון.
 * לא מחזיר שום נתון אחר של הפרויקט (לא דוחות, לא משתמשים) — רק שם הפרויקט והתשובות של השאלון עצמו.
 */
import { NextResponse } from 'next/server'
import { adminClient } from '../../../../lib/auth'
import { rateLimit, tooManyRequests } from '../../../../lib/rate-limit'
import { cleanAnswers, stepsFromAnswers, FORM_AUTHOR } from '../../../../lib/onboarding-form.js'

export const dynamic = 'force-dynamic'
const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })
const TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/
const ipOf = (req) => String(req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'

async function load(sb, token) {
  if (!TOKEN_RE.test(token || '')) return null
  const { data } = await sb.from('onboarding_forms').select('project_id, answers, submitted_at, revoked, projects(name)').eq('token', token).maybeSingle()
  return data && !data.revoked ? data : null
}

export async function GET(req) {
  const token = new URL(req.url).searchParams.get('token') || ''
  const rl = await rateLimit('onboarding-form-get', ipOf(req), 60, 600)
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec)
  const f = await load(adminClient(), token)
  if (!f) return J({ error: 'הקישור לא תקין או שבוטל' }, 404)
  return J({ project: f.projects?.name || '', answers: f.answers || {}, submitted_at: f.submitted_at })
}

export async function POST(req) {
  const b = await req.json().catch(() => ({}))
  const rl = await rateLimit('onboarding-form-save', `${ipOf(req)}|${String(b.token || '').slice(0, 12)}`, 120, 600)
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec)
  if (JSON.stringify(b.answers || {}).length > 200000) return J({ error: 'too large' }, 413)
  const sb = adminClient()
  const f = await load(sb, b.token)
  if (!f) return J({ error: 'הקישור לא תקין או שבוטל' }, 404)
  const answers = { ...(f.answers || {}), ...cleanAnswers(b.answers) }
  const now = new Date().toISOString()
  const { error } = await sb.from('onboarding_forms').update({ answers, updated_at: now, ...(b.submit ? { submitted_at: now } : {}) }).eq('token', b.token)
  if (error) return J({ error: 'השמירה נכשלה' }, 500)

  // שלבים בקליטה — לא דורסים סימון ידני
  const steps = stepsFromAnswers(answers)
  const keys = Object.keys(steps)
  if (keys.length) {
    const { data: cur } = await sb.from('project_onboarding').select('step, status, updated_by').eq('project_id', f.project_id).in('step', keys)
    const curBy = new Map((cur || []).map(r => [r.step, r]))
    const rows = keys.filter(k => { const c = curBy.get(k); return !c || c.status === 'todo' || c.updated_by === FORM_AUTHOR })
      .map(k => ({ project_id: f.project_id, step: k, status: steps[k].status, note: steps[k].note, updated_by: FORM_AUTHOR, updated_at: now }))
    if (rows.length) await sb.from('project_onboarding').upsert(rows, { onConflict: 'project_id,step' })
  }
  return J({ ok: true, saved_at: now })
}
