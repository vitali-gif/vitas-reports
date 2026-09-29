/**
 * /api/cron/prefetch-ads — Meta + Google only (runs in ~20-25s, well under 60s limit)
 * Runs at 07:00 + 14:00 Israel time. BMBY handled separately by /api/cron/prefetch-crm.
 */
import { sendAlert } from '../../../../lib/alert'
import { logJob } from '../../../../lib/job-log'
import { createClient } from '@supabase/supabase-js'
import { runCron } from '../../../../lib/cron-background'

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
  if (Array.isArray(d.assetGroupErrors) && d.assetGroupErrors.length) out.assetGroupErrors = d.assetGroupErrors.slice(0, 3)
  if (Array.isArray(d.projects)) {
    out.projects = d.projects.map(p => {
      const r = { project: p.project }
      const n = (p.counts && p.counts.leads) ?? p.leads
      if (n !== undefined && n !== null) r.leads = n
      if (p.ok === false) r.ok = false
      if (p.error) r.error = String(p.error).slice(0, 120)
      return r
    })
  }
  return out
}

/** שורת כישלון קריאה אחת: מי, מה, ולמה. אותו פורמט במייל ההתראה וב-job_log. */
const _describe = (r) =>
  [r.source, r.label, r.error || (r.status ? `HTTP ${r.status}` : '')]
    .filter(Boolean).join(' · ').slice(0, 200)

// B16: cron-job.org מנתק אחרי 30 שניות — עונים מיד וממשיכים ברקע. ?wait=1 = להמתין לתוצאה.
export async function GET(request) {
  return runCron(request, 'prefetch-ads', handle)
}

async function handle(request) {
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

  // ═══ חלוקה לחם/קר (27.9.2026) ═════════════════════════════════════════════
  //
  // הרקע: הריצה נמדדה על 181–235 שניות מול maxDuration של 300 — כלומר 60–78%
  // מהתקציב, כל ריצה. ב-27.9 משיכת google/last14 נתקעה, הריצה הגיעה ל-372
  // שניות והשער החזיר 504. זו לא הייתה תקלה חד־פעמית אלא החצייה הראשונה של קו
  // שהתקרבנו אליו מזמן.
  //
  // ומספר המשימות לא גדל עם מספר הפרויקטים — הוא נגזר מ-presets × מקורות. מה
  // שגדל הוא העבודה *בתוך* כל משימה, כי כל route עובר על כל הפרויקטים בפנים.
  // ב-7 פרויקטים ו-200 שניות זה יוצא כ-28 שניות לפרויקט, כלומר התקרה היא סביב
  // 10–14 פרויקטים. לא 50.
  //
  // הקריטריון לחלוקה הוא אחד: **האם התקופה עוד יכולה להשתנות.**
  //   חם  — טווח שנוגע בחלון הייחוס של מטא (8 ימים אחורה). רץ כל שעתיים.
  //   קר  — רבעון או חודש סגורים. הנתונים שלהם קפואים; פעם ביום מספיק.
  //   דילוג — טווח שטרם התחיל. אין מה למשוך.
  //
  // ⚠️ למה 8 ימים ולא "נוגע בהיום": last7/last14/last30 מסתיימים *אתמול*
  //    (daysBackRange מחזיר until = agoD(1)), ולכן כלל של "עד היום" היה מסווג
  //    אותם כקרים — בעוד שדווקא הם החלון שבו מטא עוד מעדכנת המרות.
  const ATTRIBUTION_DAYS = 8
  const _today = toYMD(nowIsrael())
  const _hotFrom = toYMD(agoD(ATTRIBUTION_DAYS))
  const mode = (new URL(request.url).searchParams.get('mode') || 'all').toLowerCase()
  const wants = (hot) => mode === 'all' || (hot ? mode === 'hot' : mode === 'cold')

  const jobs = []
  const skipped = []

  months.forEach((month, i) => {
    const hot = i === 0            // רק החודש הנוכחי עוד משתנה
    if (!wants(hot)) return
    for (const source of sources) jobs.push({ kind: 'month', label: month, source, hot, payload: { month } })
  })

  for (const r of rangePresets) {
    // 🔴 רבעון עתידי נמשך עד היום כל שעתיים והחזיר תמיד כלום — שתי משימות מבוזבזות
    //    בכל ריצה. גרוע מזה: המפתח שנוצר ממנו (2026-10-01_2026-12-31) גדול מכל
    //    מפתח של ספטמבר, ולכן pickDefaultMonth נחת עליו וכל לקוח ראה אפסים
    //    (נמצא ב-19.9). הדילוג כאן מסיר את המקור, ולא רק את התסמין.
    if (r.since > _today) { skipped.push(r.id); continue }
    const hot = r.until >= _hotFrom
    if (!wants(hot)) continue
    for (const source of sources) jobs.push({ kind: 'range', label: `${r.id} (${r.since}..${r.until})`, source, hot, payload: { since: r.since, until: r.until } })
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://reports.vitas.co.il'
  const internalKey = process.env.CRON_SECRET || ''   // קריאה פנימית שרת-לשרת
  const results = []

  // תקציב הריצה כולה. הפונקציה נהרגת ב-maxDuration בלי אזהרה, ולכן עוצרים לפני —
  // עדיף ריצה שמדווחת "נשארו 4 משימות" מאשר ריצה שנעלמת באמצע בלי job_log.
  const RUN_BUDGET_MS = 250_000
  const deadline = startedAt + RUN_BUDGET_MS
  // תקרה למשיכה בודדת. ב-27.9 משיכת google/last14 נתקעה וגררה את כל הריצה ל-372
  // שניות — מעל ה-300 — והשער החזיר 504 על *הריצה*, לא על המשיכה. עם תקרה
  // פרטנית משיכה תקועה נקטעת לבד, נרשמת ככישלון אחד, ושאר המשימות ממשיכות.
  //
  // ⚠️ 90 שניות היה צר מדי (28.9). משיכת רבעון מלא היא הכבדה ביותר שיש כאן —
  //    זו בדיוק הסיבה ש-maxDuration ב-meta/fetch ו-google/fetch הועלה בזמנו
  //    מ-60 ל-300 ("full-quarter fetches (q1-q4) exceeded 60s"). התקרה הפכה
  //    משיכות שהצליחו לכשלונות: meta/q1 ו-meta/q2 בריצת cold, ו-meta/q3 בכל
  //    ריצת hot — התראה בכל שעתיים על משהו שלא היה שבור.
  //
  //    התקרה הזאת אינה ההגנה על הריצה כולה; ההגנה היא budgetLeft ב-run(),
  //    שמקצר כל מד־זמן כך שאף משיכה לא חורגת מהדדליין. התפקיד היחיד של
  //    המספר כאן הוא שמשיכה *תקועה* לא תחזיק מקום בתור עד סוף התקציב.
  const JOB_TIMEOUT_MS = 180_000

  async function run(job) {
    const t0 = Date.now()
    const budgetLeft = deadline - Date.now()
    if (budgetLeft <= 0) {
      results.push({ kind: job.kind, label: job.label, source: job.source, ok: false, deferred: true, ms: 0, error: 'run budget exhausted' })
      return
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), Math.min(JOB_TIMEOUT_MS, budgetLeft))
    try {
      // cache:'no-store' is ESSENTIAL: without it these internal fetches were served from
      // cache (a whole 26-job run finished in ~1.2s, individual Meta calls in ~21ms) — so the
      // cron reported ok:true while NOT actually pulling fresh data or writing the heartbeat.
      const res = await fetch(`${base}/api/${job.source}/fetch`, { method: 'POST', cache: 'no-store', signal: ctrl.signal, next: { revalidate: 0 }, headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey }, body: JSON.stringify(job.payload) })
      const data = await res.json().catch(() => ({}))
      results.push({ kind: job.kind, label: job.label, source: job.source, ok: res.ok, status: res.status, ms: Date.now()-t0, ..._slim(data) })
    } catch (err) {
      const aborted = ctrl.signal.aborted
      results.push({ kind: job.kind, label: job.label, source: job.source, ok: false, ...(aborted ? { timedOut: true } : {}),
        ms: Date.now()-t0, error: aborted ? `job timeout after ${Math.round((Date.now()-t0)/1000)}s` : String(err) })
    } finally {
      clearTimeout(timer)
    }
  }

  const CONCURRENCY = 6
  const queue = [...jobs]
  const inFlight = new Set()
  while (queue.length > 0 || inFlight.size > 0) {
    while (queue.length > 0 && inFlight.size < CONCURRENCY) { const p = run(queue.shift()).finally(() => inFlight.delete(p)); inFlight.add(p) }
    if (inFlight.size > 0) await Promise.race(inFlight)
  }

  // ── עובדות יומיות: הוסרו מכאן (20.09.2026) ────────────────────────────────────
  // עד היום רץ כאן בלוק שקרא ל-/api/ads/daily-sync במצבים recent ו-backfill. בדיוק אותה
  // עבודה רצה ב-/api/cron/prefetch-daily, שנוצר במקור *בגלל* שהבלוק הזה נהרג בחוסר זמן.
  // הבלוק מעולם לא הוסר, ולכן שני הקרונים משכו כל שעה את אותם 11 החשבונות באותו חלון
  // תאריכים — prefetch-ads בדקה :07 ו-prefetch-daily בדקה :25. נמדד ב-job_log ב-19.09:
  // שתי הריצות, אותם jobs, אותו טווח, אותן שגיאות.
  //
  // המחיר היה כפול קריאות ל-Google Ads API, וב-19.09 זה הגיע לתקרת המכסה: ארבעה חשבונות
  // חזרו 429 RESOURCE_EXHAUSTED במשך ארבע שעות. מאז שנשאר קרון אחד — אין כפילות.
  // אם מחזירים את הבלוק לכאן, יש לכבות את prefetch-daily, לא להריץ את שניהם.

  const failed = results.filter(r => !r.ok)
  if (failed.length > 0) {
    const fmt = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' }).format(new Date())
    const failList = failed.slice(0, 30).map(f => `<li>${_describe(f)}</li>`).join('')
    const html = `
      <div style="font-family:Arial,sans-serif;direction:rtl;text-align:right">
        <h2>⚠️ קרון מודעות (Meta/Google) — ${failed.length} משימות נכשלו</h2>
        <p>${fmt}</p>
        <ul>${failList}</ul>
        <p style="color:#888;font-size:12px">Tovno by Vitas · ניטור אוטומטי</p>
      </div>`
    try { await sendAlert({ subject: `⚠️ Tovno Ads cron: ${failed.length} משימות נכשלו`, html }) } catch {}
  }
  // === Monthly budget threshold alerts (ש.ברוך projects with a budget set) ===
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY   // בלי נפילה חזרה למפתח הציבורי: חסר = 500 מפורש
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
        await sendAlert({ subject: `\ud83d\udcb0 Tovno \u05ea\u05e7\u05e6\u05d9\u05d1: ` + crossings.map(c => `${c.project} ${c.pct}%`).join(', '), html })
      }
    }
  } catch {}

  // heartbeat for the health watchdog (explicit timestamp -> updates every run)
  //
  // ⚠️ למה גם job_log וגם heartbeat (21.9): ה-heartbeat נכתב רק בסוף הריצה, ולכן
  // ריצה שנפלה באמצע לא משאירה שום עקבה — השומר רואה "לא רץ" ואי אפשר לדעת אם
  // היא לא התחילה, קרסה, או נחסמה ב-429 של גוגל. עד 20.9 הפער הזה היה מכוסה
  // במקרה, כי הבלוק היומי שרץ כאן רשם `prefetch-ads:daily-block` ל-job_log בכל
  // ריצה. הבלוק הוסר (הוא שכפל את prefetch-daily), ואיתו נעלמה גם ההיסטוריה.
  // עכשיו הרישום מפורש: כל ריצה נרשמת, גם כושלת, עם מספר הכשלים והשגיאה הראשונה.
  try {
    const _su = process.env.NEXT_PUBLIC_SUPABASE_URL
    const _sk = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (_su && _sk) {
      const _hb = createClient(_su, _sk, { auth: { persistSession: false } })
      await logJob(_hb, 'prefetch-ads', failed.length === 0, Date.now() - startedAt, {
        mode,                                   // hot / cold / all — כדי שאפשר יהיה להשוות זמנים בין המצבים
        totalJobs: jobs.length,
        completed: results.length,
        failed: failed.length,
        timedOut: results.filter(r => r.timedOut).length,
        deferred: results.filter(r => r.deferred).length,
        skippedFuture: skipped.length ? skipped : undefined,
        // ⚠️ עד 28.9 נרשם כאן `failed[0].error` בלבד, ולכן כל כישלון תקרה נראה
        //    בלוג כ-"job timeout after 90s" בלי לומר *איזו* משיכה נתקעה — וזה
        //    היה כל מה שהיה צריך כדי לאבחן. השדה מזהה עכשיו את המשימה.
        firstError: failed.length ? _describe(failed[0]) : null,
        failures: failed.length ? failed.slice(0, 8).map(_describe) : undefined,
        // B2: קריאייטיב PMax שלא נמשך. המשיכה עצמה הצליחה והגלריה הקודמת נשמרה, ולכן זה
        //    לא כישלון — אבל עד היום זה לא הופיע בשום מקום, וכך הגלריה התרוקנה בשקט.
        assetGroupErrors: (() => { const e = [...new Set(results.flatMap(r => r.assetGroupErrors || []))]; return e.length ? e.slice(0, 5) : undefined })(),
        // הזמנים של המשיכות הכבדות — כדי שהתקרה תיקבע לפי מדידה ולא לפי ניחוש.
        slowest: results.slice().sort((a, b) => (b.ms || 0) - (a.ms || 0)).slice(0, 3)
          .map(r => `${r.source} · ${r.label} · ${Math.round((r.ms || 0) / 1000)}s`),
      })
      // ⚠️ ה-heartbeat נכתב רק בריצה שכוללת את החלק החם. ריצת cold בלילה אינה
      //    עדות לכך שהמשיכות השוטפות עובדות, ואם היא תעדכן את ה-heartbeat —
      //    שומר הקרונים יראה "רץ לפני שעה" בזמן שהחלק החם מת. זה בדיוק סוג
      //    ההסתרה שהשומר נועד למנוע.
      if (mode !== 'cold') {
        await _hb.from('cron_heartbeat').upsert({ job: 'prefetch-ads', last_run: new Date().toISOString() }, { onConflict: 'job' })
      }
    }
  } catch {}
  return Response.json({ ok: failed.length === 0, summary: { mode, totalJobs: jobs.length, completed: results.length, failed: failed.length, timedOut: results.filter(r => r.timedOut).length, deferred: results.filter(r => r.deferred).length, skippedFuture: skipped, elapsedMs: Date.now()-startedAt }, results })
}
