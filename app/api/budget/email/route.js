// POST /api/budget/email  { projectId, budget? }
// Computes a project's current-month budget status (FB+Google spend) and emails it
// via Resend (sendAlert). If `budget` is supplied it is used for the email only
// (demo) without touching the stored monthly_budgets. Auth: x-client-key = anon.
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../../lib/auth'
import { sendAlert } from '../../../../lib/alert'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  const auth = await requireAuth(request, { adminOnly: true, allowCron: true })
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  const body = await request.json().catch(() => ({}))
  const projectId = body.projectId
  if (!projectId) return Response.json({ error: 'projectId required' }, { status: 400 })

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } }
  )
  const { data: pr } = await sb.from('projects').select('id, name, monthly_budgets').eq('id', projectId).single()
  if (!pr) return Response.json({ error: 'project not found' }, { status: 404 })

  const il = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }))
  const ym = il.getFullYear() + '-' + String(il.getMonth() + 1).padStart(2, '0')

  const budget = (body.budget != null && body.budget !== '') ? Number(body.budget) : ((pr.monthly_budgets || {})[ym])

  const { data: reps } = await sb.from('reports').select('summary, source').eq('project_id', pr.id).eq('month', ym)
  let spend = 0
  for (const r of (reps || [])) {
    if (r.source === 'facebook' || (r.source || '').startsWith('google')) spend += (r.summary?.spend || 0)
  }
  const pct = budget ? Math.round(spend / budget * 100) : null
  const flag = pct == null ? '' : pct >= 100 ? ' ⚠️ חריגה' : pct >= 95 ? ' 🔴' : pct >= 75 ? ' 🟠' : ' 🟢'

  const ils = n => '₪' + Math.round(n).toLocaleString('he-IL')
  const html = `<div style="font-family:Arial,sans-serif;direction:rtl;text-align:right">
    <h2>💰 מצב תקציב חודשי — ${pr.name} (${ym})</h2>
    <table style="border-collapse:collapse;font-size:15px">
      <tr><td style="padding:4px 12px">תקציב חודשי</td><td style="padding:4px 12px"><b>${budget ? ils(budget) : 'לא הוגדר'}</b></td></tr>
      <tr><td style="padding:4px 12px">נוצל עד כה (פייסבוק+גוגל)</td><td style="padding:4px 12px"><b>${ils(spend)}</b></td></tr>
      ${pct != null ? `<tr><td style="padding:4px 12px">אחוז ניצול</td><td style="padding:4px 12px"><b>${pct}%${flag}</b></td></tr>` : ''}
      ${budget ? `<tr><td style="padding:4px 12px">נותר</td><td style="padding:4px 12px"><b>${ils(Math.max(0, budget - spend))}</b></td></tr>` : ''}
    </table>
    <p style="color:#888;font-size:12px">VITAS Reports · ${body.budget != null ? 'תקציב לדוגמה (לא נשמר)' : 'מצב נוכחי'}</p>
  </div>`

  const res = await sendAlert({ subject: `💰 מצב תקציב — ${pr.name} (${ym})${pct != null ? ` · ${pct}%` : ''}`, html })
  return Response.json({ ok: res.ok, emailStatus: res.status, ym, budget, spend, pct })
}
