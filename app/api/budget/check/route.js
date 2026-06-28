// POST /api/budget/check — runs the monthly-budget threshold check on demand
// (same logic as the prefetch-ads cron). Sends 75/95/100% alerts for any project
// that newly crossed a threshold this month, and marks them sent. Auth: x-client-key=anon.
import { createClient } from '@supabase/supabase-js'
import { sendAlert } from '../../../../lib/alert'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  const anon = request.headers.get('x-client-key')
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || anon !== process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } }
  )
  const il = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }))
  const ym = il.getFullYear() + '-' + String(il.getMonth() + 1).padStart(2, '0')

  const { data: projs } = await sb.from('projects').select('id, name, monthly_budgets, budget_alerts_sent')
  const crossings = []
  const checked = []
  for (const pr of (projs || [])) {
    try {
      const budget = (pr.monthly_budgets || {})[ym]
      if (!budget || budget <= 0) continue
      const { data: reps } = await sb.from('reports').select('summary, source').eq('project_id', pr.id).eq('month', ym)
      let spend = 0
      for (const r of (reps || [])) {
        if (r.source === 'facebook' || (r.source || '').startsWith('google')) spend += (r.summary?.spend || 0)
      }
      const pct = Math.round(spend / budget * 100)
      const sent = ((pr.budget_alerts_sent || {})[ym]) || []
      const newly = [75, 95, 100].filter(t => pct >= t && !sent.includes(t))
      checked.push({ project: pr.name, budget, spend: Math.round(spend), pct, alreadySent: sent, newly })
      if (newly.length) {
        const merged = [...new Set([...sent, ...newly])].sort((a, b) => a - b)
        await sb.from('projects').update({ budget_alerts_sent: { ...(pr.budget_alerts_sent || {}), [ym]: merged } }).eq('id', pr.id)
        crossings.push({ project: pr.name, budget, spend, pct, newly })
      }
    } catch (e) { /* skip one project */ }
  }
  if (crossings.length) {
    const ils = n => '₪' + Math.round(n).toLocaleString('he-IL')
    const rows = crossings.map(c => `<li><b>${c.project}</b> — ${c.pct}% מהתקציב (${ils(c.spend)} / ${ils(c.budget)}) · ספים שנחצו: ${c.newly.join('%, ')}%</li>`).join('')
    const html = `<div style="font-family:Arial,sans-serif;direction:rtl;text-align:right"><h2>💰 התראת תקציב חודשי (${ym})</h2><ul>${rows}</ul><p style="color:#888;font-size:12px">VITAS Reports · בדיקת תקציב</p></div>`
    await sendAlert({ subject: `💰 VITAS תקציב: ` + crossings.map(c => `${c.project} ${c.pct}%`).join(', '), html })
  }
  return Response.json({ ok: true, ym, alertsSent: crossings.length, checked })
}
