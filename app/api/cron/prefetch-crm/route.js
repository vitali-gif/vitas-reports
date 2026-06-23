/**
 * /api/cron/prefetch-crm — BMBY (CRM) only
 * Runs monthly data + today + last7 only. BMBY SOAP is slow — keeping jobs minimal
 * so we stay well under the 60s Vercel Hobby limit.
 * Jobs: 3 months + 2 ranges = 5 total, concurrency 2, ~25-35s
 */
import { sendAlert } from '../../../../lib/alert'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

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

  // All ranges: 3 months + 9 range presets = 12 jobs total (Pro plan: 300s timeout)
  const yr = nowIsrael().getFullYear()
  const q = (m0, d0, m1, d1) => ({ since: `${yr}-${String(m0).padStart(2,'0')}-${String(d0).padStart(2,'0')}`, until: `${yr}-${String(m1).padStart(2,'0')}-${String(d1).padStart(2,'0')}` })
  const rangePresets = [
    { id: 'today',     since: todayStr, until: todayStr },
    { id: 'currentMonth', since: `${yr}-${String(nowIsrael().getMonth()+1).padStart(2,'0')}-01`, until: todayStr }, // 1→today — matches app 'החודש הנוכחי' preset
    { id: 'yesterday', since: toYMD(agoD(1)), until: toYMD(agoD(1)) },
    { id: 'last7',     since: last7Since, until: last7Until },
    { id: 'last14',    since: toYMD(agoD(14)), until: last7Until },
    { id: 'last30',    since: toYMD(agoD(30)), until: last7Until },
    { id: 'q1', ...q(1,1,3,31) }, { id: 'q2', ...q(4,1,6,30) },
    { id: 'q3', ...q(7,1,9,30) }, { id: 'q4', ...q(10,1,12,31) },
  ]
  const jobs = [
    ...months.map(month => ({ kind: 'month', label: month, payload: { month } })),
    ...rangePresets.map(r => ({ kind: 'range', label: `${r.id} (${r.since}..${r.until})`, rangeId: r.id, payload: { since: r.since, until: r.until } })),
  ]

  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://reports.vitas.co.il'
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  const results = []

  // BCureLaser / Zoho doesn't use quarterly views, and a full quarter usually exceeds
  // Zoho's 2000-record search limit (LIMIT_REACHED) — which fails the job and triggers a
  // false alert email every run. So skip the Zoho fetch for q1-q4. BMBY (ש.ברוך) still runs
  // for quarters, since those clients do use quarterly ranges.
  const ZOHO_SKIP_RANGES = ['q1', 'q2', 'q3', 'q4']
  async function run(job) {
    const t0 = Date.now()
    // Fire Zoho CRM (BCureLaser) in parallel — it only writes to BCureLaser project
    const skipZoho = ZOHO_SKIP_RANGES.includes(job.rangeId)
    const zohoPromise = skipZoho
      ? null
      : fetch(`${base}/api/zoho/fetch`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-client-key': anonKey }, body: JSON.stringify(job.payload) })
          .then(r => r.json()).catch(() => ({}))
    try {
      const res = await fetch(`${base}/api/bmby/fetch`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-client-key': anonKey }, body: JSON.stringify(job.payload) })
      const data = await res.json().catch(() => ({}))
      results.push({ kind: job.kind, label: job.label, source: 'bmby', ok: res.ok, status: res.status, ms: Date.now()-t0, ...data })
    } catch (err) {
      results.push({ kind: job.kind, label: job.label, source: 'bmby', ok: false, ms: Date.now()-t0, error: String(err) })
    }
    // Wait for Zoho and record result (non-fatal if it fails). Skipped entirely for quarters.
    if (zohoPromise) {
      try {
        const zohoData = await zohoPromise
        results.push({ kind: job.kind, label: job.label, source: 'zoho', ok: zohoData.ok ?? false, ms: Date.now()-t0, ...zohoData })
      } catch {}
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
  // Collect projects whose CRM write was skipped because the fetch looked broken.
  const brokenProjects = []
  for (const r of results) for (const pr of (r.projects || [])) {
    if (pr && pr.skippedBroken) brokenProjects.push(`${pr.project} — ${r.label}`)
  }

  // Email alert if anything failed or any report was skipped as broken.
  if (failed.length > 0 || brokenProjects.length > 0) {
    const fmt = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' }).format(new Date())
    const failList = failed.slice(0, 30).map(f => `<li>${f.source || ''} · ${f.label || ''} · ${f.error || ('HTTP ' + (f.status||''))}</li>`).join('')
    const brokenList = brokenProjects.map(b => `<li>${b}</li>`).join('')
    const html = `
      <div style="font-family:Arial,sans-serif;direction:rtl;text-align:right">
        <h2>⚠️ קרון CRM (BMBY) — בעיה בהרצה</h2>
        <p>${fmt} · ${failed.length} כשלים · ${brokenProjects.length} דוחות שבורים שדולגו</p>
        ${brokenProjects.length ? `<h3>דוחות שבורים שלא נשמרו (נשמר הקודם הטוב):</h3><ul>${brokenList}</ul>` : ''}
        ${failed.length ? `<h3>משימות שנכשלו:</h3><ul>${failList}</ul>` : ''}
        <p style="color:#888;font-size:12px">VITAS Reports · ניטור אוטומטי</p>
      </div>`
    try { await sendAlert({ subject: `⚠️ VITAS CRM cron: ${failed.length} כשלים, ${brokenProjects.length} שבורים`, html }) } catch {}
  }

  return Response.json({ ok: failed.length === 0 && brokenProjects.length === 0, summary: { totalJobs: jobs.length, completed: results.length, failed: failed.length, brokenSkipped: brokenProjects.length, elapsedMs: Date.now()-startedAt }, brokenProjects, results })
}
