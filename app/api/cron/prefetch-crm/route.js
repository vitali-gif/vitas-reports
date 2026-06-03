/**
 * /api/cron/prefetch-crm — BMBY (CRM) only
 * Runs monthly data + today + last7 only. BMBY SOAP is slow — keeping jobs minimal
 * so we stay well under the 60s Vercel Hobby limit.
 * Jobs: 3 months + 2 ranges = 5 total, concurrency 2, ~25-35s
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function nowIsrael() {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' })
  const [year, month, day] = fmt.format(new Date()).split('-').map(Number)
  return new Date(year, month - 1, day)
}
function monthsBack(n) { const d = nowIsrael(); d.setDate(1); d.setMonth(d.getMonth() - n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` }
function toYMD(d) { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0') }
function agoD(n) { const d = nowIsrael(); d.setDate(d.getDate()-n); return d }

export async function GET(request) {
  const startedAt = Date.now()
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '').trim()
  if (!process.env.CRON_SECRET || bearer !== process.env.CRON_SECRET) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const months = [0, 1, 2].map(monthsBack)
  const today = nowIsrael()
  const todayStr = toYMD(today)
  const last7Since = toYMD(agoD(7))
  const last7Until = toYMD(agoD(1))

  // 5 jobs total: 3 months + today + last7
  const jobs = [
    ...months.map(month => ({ kind: 'month', label: month, payload: { month } })),
    { kind: 'range', label: `today (${todayStr})`, payload: { since: todayStr, until: todayStr } },
    { kind: 'range', label: `last7 (${last7Since}..${last7Until})`, payload: { since: last7Since, until: last7Until } },
  ]

  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://reports.vitas.co.il'
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  const results = []

  async function run(job) {
    const t0 = Date.now()
    try {
      const res = await fetch(`${base}/api/bmby/fetch`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-client-key': anonKey }, body: JSON.stringify(job.payload) })
      const data = await res.json().catch(() => ({}))
      results.push({ kind: job.kind, label: job.label, source: 'bmby', ok: res.ok, status: res.status, ms: Date.now()-t0, ...data })
    } catch (err) {
      results.push({ kind: job.kind, label: job.label, source: 'bmby', ok: false, ms: Date.now()-t0, error: String(err) })
    }
  }

  // Concurrency 2 — gentle on BMBY SOAP
  const CONCURRENCY = 2
  const queue = [...jobs]
  const inFlight = new Set()
  while (queue.length > 0 || inFlight.size > 0) {
    while (queue.length > 0 && inFlight.size < CONCURRENCY) { const p = run(queue.shift()).finally(() => inFlight.delete(p)); inFlight.add(p) }
    if (inFlight.size > 0) await Promise.race(inFlight)
  }

  const failed = results.filter(r => !r.ok)
  return Response.json({ ok: failed.length === 0, summary: { totalJobs: jobs.length, completed: results.length, failed: failed.length, elapsedMs: Date.now()-startedAt }, results })
}
