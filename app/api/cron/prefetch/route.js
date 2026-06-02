/**
 * /api/cron/prefetch  — daily cron that pre-populates Supabase cache
 * so the dashboard renders instantly (no live fetch needed) for the
 * date ranges users actually hit.
 *
 * Pre-warms these for each of Meta / Google / BMBY:
 *   - Current month
 *   - Previous month
 *   - 2 months ago
 *   - "Today" preset            (since=today, until=today)
 *   - "Yesterday" preset        (since=yesterday, until=yesterday)
 *   - "Last 7 days"             (since=7d-ago, until=yesterday)
 *   - "Last 14 days"            (since=14d-ago, until=yesterday)
 *   - "Last 30 days"            (since=30d-ago, until=yesterday)
 *
 * Cache key math matches admin/page.js and TitleBar MOBILE_PRESETS:
 * for range presets the key is `${since}_${until}`. The dashboard's
 * triggerFetch() looks for that exact key in `reports` and renders
 * instantly when it hits.
 *
 * Concurrency: 24 jobs (8 ranges × 3 sources) in parallel batches
 * of 6 so we stay under 60s while not hammering BMBY too hard.
 *
 * Vercel cron calls this with:
 *   Authorization: Bearer <CRON_SECRET>
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60   // Vercel Hobby max — must be set, default is 10s

// Returns today's date as a plain local Date object, calculated in
// Israel time (Asia/Jerusalem, UTC+2/+3). Without this, the server
// running in UTC would compute "yesterday" / "today" wrong between
// 00:00-03:00 Israel time, causing cache misses on the dashboard.
function nowIsrael() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const [year, month, day] = fmt.format(new Date()).split('-').map(Number)
  return new Date(year, month - 1, day)
}

function monthsBack(n) {
  const d = nowIsrael()
  d.setDate(1)
  d.setMonth(d.getMonth() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function toYMD(d) {
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0')
}

function sod(d) { const x = new Date(d); x.setHours(0,0,0,0); return x }
function agoD(n) { const d = nowIsrael(); d.setDate(d.getDate() - n); return d }

// Matches TitleBar.jsx MOBILE_PRESETS exactly:
//   last7  → agoD(7) → agoD(1)
//   last14 → agoD(14) → agoD(1)
//   last30 → agoD(30) → agoD(1)
function daysBackRange(n) { return { since: toYMD(agoD(n)), until: toYMD(agoD(1)) } }
function todayRange()     { const t = nowIsrael();                                 return { since: toYMD(t), until: toYMD(t) } }
function yesterdayRange() { const t = nowIsrael(); t.setDate(t.getDate() - 1);     return { since: toYMD(t), until: toYMD(t) } }

export async function GET(request) {
  const startedAt = Date.now()

  // Validate cron secret
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '').trim()
  if (!process.env.CRON_SECRET || bearer !== process.env.CRON_SECRET) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const months = [0, 1, 2].map(monthsBack)
  // Quarterly ranges for current year
  const yr = nowIsrael().getFullYear()
  const q = (m0, d0, m1, d1) => ({
    since: `${yr}-${String(m0).padStart(2,'0')}-${String(d0).padStart(2,'0')}`,
    until: `${yr}-${String(m1).padStart(2,'0')}-${String(d1).padStart(2,'0')}`,
  })

  const rangePresets = [
    { id: 'today',     ...todayRange() },
    { id: 'yesterday', ...yesterdayRange() },
    { id: 'last7',     ...daysBackRange(7) },
    { id: 'last14',    ...daysBackRange(14) },
    { id: 'last30',    ...daysBackRange(30) },
    { id: 'q1',        ...q(1,1,3,31) },
    { id: 'q2',        ...q(4,1,6,30) },
    { id: 'q3',        ...q(7,1,9,30) },
    { id: 'q4',        ...q(10,1,12,31) },
  ]
  const sources = ['meta', 'google', 'bmby']

  // Build the job list — PRIORITY ORDER so the most volatile data runs first.
  // Vercel Hobby cap: 60s. Each batch of CONCURRENCY takes ~15-20s.
  // Priority: daily presets (change every day) > current month > past months > quarterly.
  // Past quarters / old months may time out — that is acceptable since they rarely change.
  const jobs = []

  const DAILY_IDS = ['today', 'yesterday', 'last7', 'last14', 'last30']
  const dailyPresets = rangePresets.filter(r => DAILY_IDS.includes(r.id))
  const otherPresets = rangePresets.filter(r => !DAILY_IDS.includes(r.id))  // q1-q4

  // 1. Daily range presets (15 jobs — 3 batches of 5, ~45s, always completes)
  for (const r of dailyPresets) {
    for (const source of sources) {
      jobs.push({
        kind: 'range',
        label: `${r.id} (${r.since}..${r.until})`,
        source,
        payload: { since: r.since, until: r.until },
      })
    }
  }

  // 2. Monthly data: current month first, then older (9 jobs)
  for (const month of months) {
    for (const source of sources) {
      jobs.push({ kind: 'month', label: month, source, payload: { month } })
    }
  }

  // 3. Quarterly presets (12 jobs — lower priority, may be skipped by timeout)
  for (const r of otherPresets) {
    for (const source of sources) {
      jobs.push({
        kind: 'range',
        label: `${r.id} (${r.since}..${r.until})`,
        source,
        payload: { since: r.since, until: r.until },
      })
    }
  }

  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  const results = []

  async function run(job) {
    const t0 = Date.now()
    try {
      const res = await fetch(`${base}/api/${job.source}/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-client-key': anonKey },
        body: JSON.stringify(job.payload),
      })
      const data = await res.json().catch(() => ({}))
      results.push({
        kind: job.kind, label: job.label, source: job.source,
        ok: res.ok, status: res.status, ms: Date.now() - t0,
        ...data,
      })
    } catch (err) {
      results.push({
        kind: job.kind, label: job.label, source: job.source,
        ok: false, ms: Date.now() - t0, error: String(err),
      })
    }
  }

  // Parallel batches of CONCURRENCY — keeps total time bounded
  // while not hammering BMBY's SOAP endpoint with all 8 ranges at once.
  const CONCURRENCY = 6
  const queue = [...jobs]
  const inFlight = new Set()
  while (queue.length > 0 || inFlight.size > 0) {
    while (queue.length > 0 && inFlight.size < CONCURRENCY) {
      const p = run(queue.shift()).finally(() => inFlight.delete(p))
      inFlight.add(p)
    }
    if (inFlight.size > 0) await Promise.race(inFlight)
  }

  const failed = results.filter(r => !r.ok)
  return Response.json({
    ok: failed.length === 0,
    summary: {
      totalJobs: jobs.length,
      completed: results.length,
      failed: failed.length,
      elapsedMs: Date.now() - startedAt,
    },
    months,
    rangePresets: rangePresets.map(r => r.id),
    results,
  })
}
