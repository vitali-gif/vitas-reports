/**
 * /api/cron/prefetch-crm — BMBY (CRM) only
 * Runs monthly data + today + last7 only. BMBY SOAP is slow — keeping jobs minimal
 * so we stay well under the 60s Vercel Hobby limit.
 * Jobs: 3 months + 2 ranges = 5 total, concurrency 2, ~25-35s
 */
import { sendAlert } from '../../../../lib/alert'
import { createClient } from '@supabase/supabase-js'
import { runCron } from '../../../../lib/cron-background'
import { logJob } from '../../../../lib/job-log'

export const dynamic = 'force-dynamic'
// force-no-store: supabase-js + internal calls go through fetch, which Next caches by
// default. That cache made the cron read/write STALE data and skip the heartbeat.
export const fetchCache = 'force-no-store'
export const maxDuration = 300

function nowIsrael() {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' })
  const [year, month, day] = fmt.format(new Date()).split('-').map(Number)
  return new Date(year, month - 1, day)
}
function monthsBack(n) { const d = nowIsrael(); d.setDate(1); d.setMonth(d.getMonth() - n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` }
function toYMD(d) { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0') }
function agoD(n) { const d = nowIsrael(); d.setDate(d.getDate()-n); return d }

// The cron response is a log line, not a data dump. Each result used to spread the ENTIRE
// body of its sub-fetch (...data) - totals, totalRaw, per-project detail - times 12 jobs.
// cron-job.org answered "Response data too big" and marked the run failed even though the
// fetch itself fully succeeded. Summarise instead of spreading.
const _slim = (d) => {
  if (!d || typeof d !== 'object') return {}
  const out = {}
  if (d.ok !== undefined) out.ok = d.ok
  if (d.error) out.error = String(d.error).slice(0, 200)
  if (typeof d.totalRows === 'number') out.totalRows = d.totalRows
  if (Array.isArray(d.projects)) {
    out.projects = d.projects.map(p => {
      const r = { project: p.project }
      const n = (p.counts && p.counts.leads) ?? p.leads
      if (n !== undefined && n !== null) r.leads = n
      if (p.ok === false) r.ok = false
      if (p.error) r.error = String(p.error).slice(0, 120)
      // תוצאת התמונה (crm_raw + crm_compact) — בלעדיה כשל בבנייה נבלע בשקט (T4, 30.9: ONCE לא
      // נבנתה 12 שעות ואף לוג לא אמר למה).
      const sn = p.snapshot
      if (sn) r.snapshot = sn.error ? { error: String(sn.error).slice(0, 160) }
        : sn.compact?.error ? { error: String(sn.compact.error).slice(0, 160) }
        : sn.compact?.skipped ? 'unchanged' : sn.compact ? 'rebuilt' : 'written'
      return r
    })
  }
  return out
}
// B16: cron-job.org מנתק אחרי 30 שניות — עונים מיד וממשיכים ברקע. ?wait=1 = להמתין לתוצאה.
export async function GET(request) {
  return runCron(request, 'prefetch-crm', handle)
}

async function handle(request) {
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
  // Split support: /api/cron/prefetch-crm?only=months  or  ?only=ranges.
  // BMBY SOAP is slow; months + 10 ranges together can exceed maxDuration (300s), which cut
  // the later RANGE jobs and left their summaries stale (no crmRepRows). Running ranges in
  // their own invocation gives them a full 300s budget so they complete + write fresh.
  const only = (new URL(request.url).searchParams.get('only') || '').toLowerCase()
  let jobs = [
    ...months.map(month => ({ kind: 'month', label: month, payload: { month } })),
    ...rangePresets.map(r => ({ kind: 'range', label: `${r.id} (${r.since}..${r.until})`, rangeId: r.id, payload: { since: r.since, until: r.until } })),
  ]
  if (only === 'months') jobs = jobs.filter(j => j.kind === 'month')
  else if (only === 'ranges') jobs = jobs.filter(j => j.kind === 'range')

  // תמונת crm_raw (טווחים מיידיים) נכתבת פעם אחת לריצה לכל מקור, לא 13 פעמים:
  // עד 17.9 כל 13 החלונות כתבו את הרשומות הגולמיות שלהם — חופפים (currentMonth ⊂ q3 ⊃ last30...)
  // ו-4 במקביל — 60k רשומות Salesforce נכתבו מחדש שוב ושוב, ה-DB נכנס ל-deadlocks ו-statement
  // timeouts, שרת ה-Auth ענה 504 ולקוחה ראתה דשבורד ריק. עכשיו: BMBY ו-Salesforce כותבים
  // את התמונה רק ברבעונים (q1..q4 — חלונות זרים שמכסים את השנה), Zoho רק בחודשים (רבעונים
  // מדולגים אצלו). שאר החלונות כותבים רק את הדוח השמור שלהם. הרבעונים רצים ראשונים כדי
  // שתקציב הזמן לא יחתוך אותם.
  const QUARTERS = ['q1', 'q2', 'q3', 'q4']
  // q4 ראשון: הוא היחיד שכותב את תמונת BMBY, ולכן הוא לא יכול להיות זה שנחתך בתקציב הזמן.
  const _qOrder = (j) => j.rangeId === 'q4' ? 0 : QUARTERS.includes(j.rangeId) ? 1 : 2
  jobs = jobs.slice().sort((a, b) => _qOrder(a) - _qOrder(b))
  // T4 (30.9): BMBY כותב את התמונה רק ברבעון האחרון (q4), לא בארבעתם. המשיכה מ-BMBY היא
  // מ-UniqID 1 ועד שהרשומות עוברות את ToDate (callBmbyGetAllJsonPaginated), ולכן כל רבעון מושך
  // מתחילת הנתונים — q4 מושך את כל מה ששלושת האחרים מושכים ועוד. עד היום ארבעתם כתבו את אותן
  // ~30 אלף רשומות לארבעה פרויקטים, ארבע פעמים בריצה. q1–q3 ממשיכים לכתוב את הדוח השמור שלהם.
  // Salesforce לא משתנה: אצלו הרבעונים הם חלונות זרים, וכל אחד כותב את החלק שלו.
  const BMBY_SNAPSHOT_QUARTER = 'q4'
  const snapshotFor = (job, source) => source === 'zoho' ? job.kind === 'month'
    : source === 'bmby' ? job.rangeId === BMBY_SNAPSHOT_QUARTER
    : QUARTERS.includes(job.rangeId)
  const bodyFor = (job, source) => JSON.stringify({ ...job.payload, snapshot: snapshotFor(job, source) })

  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://reports.vitas.co.il'
  const internalKey = process.env.CRON_SECRET || ''   // קריאה פנימית שרת-לשרת
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
      : fetch(`${base}/api/zoho/fetch`, { method: 'POST', cache: 'no-store', next: { revalidate: 0 }, headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey }, body: bodyFor(job, 'zoho') })
          .then(r => r.json()).catch(() => ({}))
    // Salesforce (KLOSS) in parallel — it only writes to KLOSS-named projects. Uses SOQL
    // aggregates, so quarters are fine (no record-count limit like Zoho).
    const sfPromise = fetch(`${base}/api/salesforce/fetch`, { method: 'POST', cache: 'no-store', next: { revalidate: 0 }, headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey }, body: bodyFor(job, 'salesforce') })
      .then(r => r.json()).catch(() => ({}))
    // Fireberry (אלפא יזמות — אקספו חיפה) במקביל. הוא כותב רק לפרויקטים שמופיעים
    // ב-FIREBERRY_PROJECTS, בדיוק כמו ש-Zoho כותב רק ל-BCureLaser.
    //
    // ⚠️ אין כאן דילוג על רבעונים כמו ב-Zoho: המשיכה היא של *כל* הרשומות בחשבון
    //    (607 ב-28.9) והסינון לטווח מקומי, ולכן טווח ארוך לא עולה יותר מטווח קצר
    //    ואין מגבלת רשומות שאפשר לחרוג ממנה.
    //
    // שליפה חיה אחת לריצה בלבד: חלון החודש הנוכחי שולף מפיירברי וכותב את התמונה, וכל
    // שאר החלונות מחושבים ממנה (fromSnapshot). עד 28.9 כל 13 החלונות שלפו את כל הלידים
    // מחדש — אותם נתונים, 13 פעם — וזה היה עובר את תקרת 100 הקריאות לדקה של פיירברי
    // ברגע שיהיו לאלפא כמה אלפי לידים. ריצת only=ranges לא שולחת עכשיו אף קריאה.
    const fbLive = job.kind === 'month' && job.payload.month === months[0]
    const fbBody = JSON.stringify({ ...job.payload, ...(fbLive ? { snapshot: true } : { fromSnapshot: true }) })
    const fbPromise = fetch(`${base}/api/fireberry/fetch`, { method: 'POST', cache: 'no-store', next: { revalidate: 0 }, headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey }, body: fbBody })
      .then(r => r.json()).catch(() => ({}))
    try {
      // cache:'no-store' — see prefetch-ads: without it these internal calls came back from
      // cache in milliseconds and no fresh data / heartbeat was written.
      const res = await fetch(`${base}/api/bmby/fetch`, { method: 'POST', cache: 'no-store', next: { revalidate: 0 }, headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey }, body: bodyFor(job, 'bmby') })
      const data = await res.json().catch(() => ({}))
      results.push({ kind: job.kind, label: job.label, source: 'bmby', ok: res.ok, status: res.status, ms: Date.now()-t0, ..._slim(data) })
    } catch (err) {
      results.push({ kind: job.kind, label: job.label, source: 'bmby', ok: false, ms: Date.now()-t0, error: String(err) })
    }
    // Wait for Zoho and record result (non-fatal if it fails). Skipped entirely for quarters.
    if (zohoPromise) {
      try {
        const zohoData = await zohoPromise
        results.push({ kind: job.kind, label: job.label, source: 'zoho', ok: zohoData.ok ?? false, ms: Date.now()-t0, ..._slim(zohoData) })
      } catch {}
    }
    try {
      const sfData = await sfPromise
      results.push({ kind: job.kind, label: job.label, source: 'salesforce', ok: sfData.ok ?? false, ms: Date.now()-t0, ..._slim(sfData) })
    } catch {}
    try {
      const fbData = await fbPromise
      // pending=true פירושו שאין FIREBERRY_TOKEN. זה מצב תצורה, לא כישלון משיכה —
      // בלי ההבחנה הזאת כל ריצה לפני הגדרת המשתנה הייתה שולחת מייל התראה.
      if (!fbData.pending) results.push({ kind: job.kind, label: job.label, source: 'fireberry', ok: fbData.ok ?? false, ms: Date.now()-t0, ..._slim(fbData) })
    } catch {}
  }

  // מקביליות: החלונות הקלים (דוחות שמורים בלבד) רצים 4 במקביל. חלונות התמונה (רבעונים — BMBY 14k
  // ו-Salesforce 59k רשומות גולמיות) רצים 2 במקביל: ב-15:37 (17.9) ארבעה כאלה יחד הביאו את ה-DB
  // ל-17 statement timeouts על נעילות שורות, גם בלי deadlocks. הרבעונים כבר ראשונים בתור.
  const CONCURRENCY = 4  // was 2 — with real (uncached) fetching the run exceeded 300s and 504'd
  const SNAPSHOT_CONCURRENCY = 2
  const isSnapshotJob = (job) => QUARTERS.includes(job.rangeId)
  // Wall-clock deadline: return BEFORE Vercel's 300s hard kill. A 504 (kill) makes the GitHub
  // Actions job fail ("all jobs have failed" email). Instead we stop starting new jobs past the
  // budget and resolve at the deadline with whatever finished — any unfinished range simply keeps
  // its previous-good report and gets refreshed on the next run. Endpoint returns HTTP 200.
  const DEADLINE_MS = 275000
  const queue = [...jobs]
  const inFlight = new Set()
  const loop = (async () => {
    while (queue.length > 0 || inFlight.size > 0) {
      // התקרה נקבעת לפי העבודה הבאה בתור: כל עוד יש רבעונים, לא יותר מ-2 בטיסה בו-זמנית.
      while (queue.length > 0 && inFlight.size < (isSnapshotJob(queue[0]) ? SNAPSHOT_CONCURRENCY : CONCURRENCY) && (Date.now() - startedAt) < DEADLINE_MS) {
        const p = run(queue.shift()).finally(() => inFlight.delete(p)); inFlight.add(p)
      }
      if (inFlight.size > 0) await Promise.race(inFlight)
      else break  // queue non-empty but budget exhausted → stop
    }
  })()
  let deadlineHit = false
  await Promise.race([loop, new Promise(r => setTimeout(() => { deadlineHit = true; r() }, DEADLINE_MS))])
  const deferredCount = queue.length + inFlight.size

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
        <p style="color:#888;font-size:12px">Tovno by Vitas · ניטור אוטומטי</p>
      </div>`
    try { await sendAlert({ subject: `⚠️ Tovno CRM cron: ${failed.length} כשלים, ${brokenProjects.length} שבורים`, html }) } catch {}
  }

  // heartbeat for the health watchdog (explicit timestamp -> updates every run)
  try {
    const _su = process.env.NEXT_PUBLIC_SUPABASE_URL
    const _sk = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (_su && _sk) {
      const _hb = createClient(_su, _sk, { auth: { persistSession: false } })
      await _hb.from('cron_heartbeat').upsert({ job: 'prefetch-crm', last_run: new Date().toISOString() }, { onConflict: 'job' })
      // רישום הריצה ל-job_log, כמו prefetch-ads. עד 30.9 קרון ה-CRM היה היחיד שלא נרשם, ולכן
      // ריצה שלא עשתה כלום (07:37, 30.9) נראתה זהה לריצה תקינה.
      const snaps = []
      for (const r of results) for (const pr of (r.projects || [])) if (pr.snapshot) snaps.push({ project: pr.project, source: r.source, label: r.label, snapshot: pr.snapshot })
      await logJob(_hb, only ? `prefetch-crm:${only}` : 'prefetch-crm', failed.length === 0 && !snaps.some(x => x.snapshot?.error), Date.now() - startedAt, {
        totalJobs: jobs.length, completed: results.length, failed: failed.length, deferred: deferredCount, deadlineHit,
        brokenSkipped: brokenProjects.length || undefined,
        failures: failed.length ? failed.slice(0, 8).map(f => `${f.source || ''} · ${f.label || ''} · ${f.error || ('HTTP ' + (f.status || ''))}`.slice(0, 200)) : undefined,
        snapshots: snaps.length ? snaps.map(x => `${x.source} · ${x.project} · ${typeof x.snapshot === 'string' ? x.snapshot : 'ERROR ' + x.snapshot.error}`) : undefined,
        slowest: results.slice().sort((a, b) => (b.ms || 0) - (a.ms || 0)).slice(0, 3).map(r => `${r.source} · ${r.label} · ${Math.round((r.ms || 0) / 1000)}s`),
      })
    }
  } catch {}
  return Response.json({ ok: failed.length === 0 && brokenProjects.length === 0, summary: { totalJobs: jobs.length, completed: results.length, failed: failed.length, brokenSkipped: brokenProjects.length, deferred: deferredCount, deadlineHit, elapsedMs: Date.now()-startedAt }, brokenProjects, results })
}
