/**
 * /api/cron/prefetch-ads — Meta + Google only (runs in ~20-25s, well under 60s limit)
 * Runs at 07:00 + 14:00 Israel time. BMBY handled separately by /api/cron/prefetch-crm.
 */
import { sendAlert } from '../../../../lib/alert'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
// force-no-store: supabase-js + internal calls go through fetch, which Next caches by
// default. That cache made the cron read/write STALE data and skip the heartbeat.
export const fetchCache = 'force-no-store'
export const maxDuration = 300  // was 60 — the budget-alert block at the end was being killed before it ran

function nowIsrael() {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' })
  const [year, month, day] = fmt.format(new Date()).split('-').map(Number)
  return new Date(year, month - 1, day)
}
function monthsBack(n) { const d = nowIsrael(); d.setDate(1); d.setMonth(d.getMonth() - n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` }
function toYMD(d) { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0') }
function agoD(n) { const d = nowIsrael(); d.setDate(d.getDate()-n); return d }
function daysBackRange(n) { return { since: toYMD(agoD(n)), until: toYMD(agoD(1)) } }
function todayRange()     { const t = nowIsrael(); return { since: toYMD(t), until: toYMD(t) } }
function yesterdayRange() { const t = nowIsrael(); t.setDate(t.getDate()-1); return { since: toYMD(t), until: toYMD(t) } }

export async function GET(request) {
  const startedAt = Date.now()
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '').trim()
  if (!process.env.CRON_SECRET || bearer !== process.env.CRON_SECRET) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const months = [0, 1, 2].map(monthsBack)
  const yr = nowIsrael().getFullYear()
  const q = (m0, d0, m1, d1) => ({ since: `${yr}-${String(m0).padStart(2,'0')}-${String(d0).padStart(2,'0')}`, until: `${yr}-${String(m1).padStart(2,'0')}-${String(d1).padStart(2,'0')}` })

  const rangePresets = [
    { id: 'today',     ...todayRange() },
    { id: 'currentMonth', since: `${yr}-${String(nowIsrael().getMonth()+1).padStart(2,'0')}-01`, until: toYMD(nowIsrael()) }, // 1→today — matches app 'החודש הנוכחי' preset
    { id: 'yesterday', ...yesterdayRange() },
    { id: 'last7',     ...daysBackRange(7) },
    { id: 'last14',    ...daysBackRange(14) },
    { id: 'last30',    ...daysBackRange(30) },
    { id: 'q1', ...q(1,1,3,31) }, { id: 'q2', ...q(4,1,6,30) },
    { id: 'q3', ...q(7,1,9,30) }, { id: 'q4', ...q(10,1,12,31) },
  ]
  const sources = ['meta', 'google']  // ADS ONLY — BMBY handled by prefetch-crm
  const jobs = []

  for (const month of months) {
    for (const source of sources) { jobs.push({ kind: 'month', label: month, source, payload: { month } }) }
  }
  for (const r of rangePresets) {
    for (const source of sources) { jobs.push({ kind: 'range', label: `${r.id} (${r.since}..${r.until})`, source, payload: { since: r.since, until: r.until } }) }
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://reports.vitas.co.il'
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  const results = []

  async function run(job) {
    const t0 = Date.now()
    try {
      // cache:'no-store' is ESSENTIAL: without it these internal fetches were served from
      // cache (a whole 26-job run finished in ~1.2s, individual Meta calls in ~21ms) — so the
      // cron reported ok:true while NOT actually pulling fresh data or writing the heartbeat.
      const res = await fetch(`${base}/api/${job.source}/fetch`, { method: 'POST', cache: 'no-store', next: { revalidate: 0 }, headers: { 'Content-Type': 'application/json', 'x-client-key': anonKey }, body: JSON.stringify(job.payload) })
      const data = await res.json().catch(() => ({}))
      results.push({ kind: job.kind, label: job.label, source: job.source, ok: res.ok, status: res.status, ms: Date.now()-t0, ...data })
    } catch (err) {
      results.push({ kind: job.kind, label: job.label, source: job.source, ok: false, ms: Date.now()-t0, error: String(err) })
    }
  }

  const CONCURRENCY = 6
  const queue = [...jobs]
  const inFlight = new Set()
  while (queue.length > 0 || inFlight.size > 0) {
    while (queue.length > 0 && inFlight.size < CONCURRENCY) { const p = run(queue.shift()).finally(() => inFlight.delete(p)); inFlight.add(p) }
    if (inFlight.size > 0) await Promise.race(inFlight)
  }

  const failed = results.filter(r => !r.ok)
  if (failed.length > 0) {
    const fmt = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' }).format(new Date())
    const failList = failed.slice(0, 30).map(f => `<li>${f.source || ''} · ${f.label || ''} · ${f.error || ('HTTP ' + (f.status||''))}</li>`).join('')
    const html = `
      <div style="font-family:Arial,sans-serif;direction:rtl;text-align:right">
        <h2>⚠️ קרון מודעות (Meta/Google) — ${failed.length} משימות נכשלו</h2>
        <p>${fmt}</p>
        <ul>${failList}</ul>
        <p style="color:#888;font-size:12px">VITAS Reports · ניטור אוטומטי</p>
      </div>`
    try { await sendAlert({ subject: `⚠️ VITAS Ads cron: ${failed.length} משימות נכשלו`, html }) } catch {}
  }
  // === Monthly budget threshold alerts (ש.ברוך projects with a budget set) ===
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (supabaseUrl && supabaseKey) {
      const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
      const _n = nowIsrael()
      const ym = `${_n.getFullYear()}-${String(_n.getMonth()+1).padStart(2,'0')}`
      const { data: projs } = await sb.from('projects').select('id, name, monthly_budgets, budget_alerts_sent')
      const crossings = []
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
          if (newly.length) {
            const merged = [...new Set([...sent, ...newly])].sort((a, b) => a - b)
            await sb.from('projects').update({ budget_alerts_sent: { ...(pr.budget_alerts_sent || {}), [ym]: merged } }).eq('id', pr.id)
            crossings.push({ project: pr.name, budget, spend, pct, newly })
          }
        } catch (e) { /* one project's failure must not abort budget alerts for the rest */ }
      }
      if (crossings.length) {
        const rows = crossings.map(c => `<li><b>${c.project}</b> — ${c.pct}% \u05de\u05d4\u05ea\u05e7\u05e6\u05d9\u05d1 (\u20aa${Math.round(c.spend).toLocaleString('he-IL')} / \u20aa${Number(c.budget).toLocaleString('he-IL')}) \u00b7 \u05e1\u05e4\u05d9\u05dd: ${c.newly.join('%, ')}%</li>`).join('')
        const html = `<div style="font-family:Arial,sans-serif;direction:rtl;text-align:right"><h2>\ud83d\udcb0 \u05d4\u05ea\u05e8\u05d0\u05ea \u05ea\u05e7\u05e6\u05d9\u05d1 \u05d7\u05d5\u05d3\u05e9\u05d9 (${ym})</h2><ul>${rows}</ul><p style="color:#888;font-size:12px">VITAS Reports</p></div>`
        await sendAlert({ subject: `\ud83d\udcb0 VITAS \u05ea\u05e7\u05e6\u05d9\u05d1: ` + crossings.map(c => `${c.project} ${c.pct}%`).join(', '), html })
      }
    }
  } catch {}

  // heartbeat for the health watchdog (explicit timestamp -> updates every run)
  try {
    const _su = process.env.NEXT_PUBLIC_SUPABASE_URL
    const _sk = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (_su && _sk) {
      const _hb = createClient(_su, _sk, { auth: { persistSession: false } })
      await _hb.from('cron_heartbeat').upsert({ job: 'prefetch-ads', last_run: new Date().toISOString() }, { onConflict: 'job' })
    }
  } catch {}
  return Response.json({ ok: failed.length === 0, summary: { totalJobs: jobs.length, completed: results.length, failed: failed.length, elapsedMs: Date.now()-startedAt }, results })
}
