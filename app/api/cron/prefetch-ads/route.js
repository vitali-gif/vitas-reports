/**
 * /api/cron/prefetch-ads — Meta + Google only (runs in ~20-25s, well under 60s limit)
 * Runs at 07:00 + 14:00 Israel time. BMBY handled separately by /api/cron/prefetch-crm.
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
      const res = await fetch(`${base}/api/${job.source}/fetch`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-client-key': anonKey }, body: JSON.stringify(job.payload) })
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
  return Response.json({ ok: failed.length === 0, summary: { totalJobs: jobs.length, completed: results.length, failed: failed.length, elapsedMs: Date.now()-startedAt }, results })
}
