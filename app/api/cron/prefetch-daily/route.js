/**
 * GET /api/cron/prefetch-daily — קרון ייעודי לעובדות היומיות של המודעות (ad_daily).
 * שלב 2 של docs/daily-ranges-plan.md.
 *
 * למה נפרד מ-prefetch-ads: הקרון של המודעות מריץ 26 משיכות (3 חודשים + 10 טווחים × 2
 * מקורות) ומתקרב לתקציב ה-300 שניות של Vercel. הבלוק היומי שנוסף לסופו דולג כשאין
 * זמן — וזה מה שקרה בריצה הראשונה (16.9 17:10: ad_daily נשארה ריקה). כאן יש לו
 * תקציב משלו: recent (7 ימים אחורה) ואז צעד backfill אחד, כל שעה.
 *
 * הרשאה: Authorization: Bearer <CRON_SECRET> (כמו שאר הקרונים; cron-job.org).
 * מומלץ לתזמן כל שעה בדקה 25 — לא מתנגש עם prefetch-ads (:07) / prefetch-crm (:37) / health (:15).
 *
 * תקציב הזמן (18.9.2026): הפונקציה נהרגת ב-300s בלי אזהרה, וכל מה שאחרי — job_log של ה-backfill,
 * שלבי Zoho/Salesforce, ה-heartbeat — פשוט לא קורה. כך זה היה כמעט בכל ריצה (ב-7 ימים: recent נרשם
 * 37 פעמים, backfill 3, Zoho/Salesforce 0), והשומר התריע "קרון נתקע" בזמן שהקרון דווקא רץ.
 * לכן: (1) heartbeat נכתב מיד אחרי recent — השלב הקריטי; (2) כל שלב מקבל deadline קשיח
 * (HARD_MS) שנאכף גם באמצע משיכה; (3) הרענונים הקצרים של ה-CRM רצים לפני ה-backfill הפתוח.
 */
import { createClient } from '@supabase/supabase-js'
import { runDailySync } from '../../../../lib/ads/daily-sync.js'
import { pruneJobLog, logJob, lastRuns } from '../../../../lib/job-log.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

/** גבול העבודה בפועל — מרווח מול ה-300s של Vercel לכתיבת job_log/heartbeat ולתשובה. */
const HARD_MS = 280000
/** תקרה לקריאה פנימית אחת (zoho/salesforce fetch) — הנתיב ממשיך לרוץ בצד שלו גם אם ננתק. */
const INTERNAL_TIMEOUT_MS = 60000

export async function GET(request) {
  const startedAt = Date.now()
  const left = () => HARD_MS - (Date.now() - startedAt)
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '').trim()
  if (!process.env.CRON_SECRET || bearer !== process.env.CRON_SECRET) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY   // בלי נפילה חזרה למפתח הציבורי: חסר = 500 מפורש
  if (!supabaseUrl || !supabaseKey) return Response.json({ ok: false, error: 'env missing' }, { status: 500 })
  const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  // heartbeat = "הקרון רץ והשלים את השלב הקריטי". השומר (health) מתריע כשהוא מתיישן.
  const beat = async () => { try { await sb.from('cron_heartbeat').upsert({ job: 'prefetch-daily', last_run: new Date().toISOString() }, { onConflict: 'job' }) } catch {} }

  const out = {}
  // ── 1. recent — הנתונים הטריים חשובים יותר מכל השאר ────────────────────────────────
  const recent = await runDailySync(sb, { mode: 'recent', budgetMs: 150000, job: 'prefetch-daily:recent' })
  out.recent = { ok: recent.body.ok, jobs: recent.body.jobs, failed: recent.body.failed, deferred: recent.body.deferred, ms: recent.body.ms,
    errors: (recent.body.results || []).filter(r => !r.ok && !r.deferred).map(r => `${r.source}/${r.account}: ${r.error}`).slice(0, 5) }
  await beat()

  // ── 2. CRM (שלב 4): רענונים קצרים לפני ה-backfill הפתוח, כדי שיקבלו בכלל תור ──────────
  // Zoho: עסקאות שהשתנו ב-3 הימים האחרונים. Salesforce (KLOSS): מה שהשתנה ב-3 הימים האחרונים.
  // במקביל, כל אחד עם תקרת זמן משלו; הקרון הרגיל (prefetch-crm) מכסה את החודשים/הטווחים.
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://reports.vitas.co.il'
  const internal = (body) => ({ method: 'POST', cache: 'no-store', next: { revalidate: 0 }, headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.CRON_SECRET || '' }, body: JSON.stringify(body), signal: AbortSignal.timeout(INTERNAL_TIMEOUT_MS) })
  const callInternal = async (path, body) => {
    const t0 = Date.now()
    try {
      const r = await fetch(`${base}${path}`, internal(body))
      const d = await r.json().catch(() => ({}))
      return { ok: r.ok && d.ok !== false, ms: Date.now() - t0, data: d }
    } catch (err) {
      return { ok: false, ms: Date.now() - t0, data: {}, error: String(err?.name === 'TimeoutError' ? `timeout after ${INTERNAL_TIMEOUT_MS}ms` : (err?.message || err)).slice(0, 200) }
    }
  }
  if (left() > INTERNAL_TIMEOUT_MS + 90000) {
    const [z, s] = await Promise.all([
      callInternal('/api/zoho/fetch', { dealsRefreshDays: 3 }),
      callInternal('/api/salesforce/fetch', { modifiedRefreshDays: 3 }),
    ])
    out.zohoDeals = { ok: z.ok, ms: z.ms, error: z.error, projects: (z.data.projects || []).map(p => ({ project: p.project, ok: p.ok, deals: p.deals, error: p.error })) }
    await logJob(sb, 'prefetch-daily:zoho-deals', z.ok, z.ms, out.zohoDeals)
    out.sfModified = { ok: s.ok, ms: s.ms, counts: s.data.counts, error: s.error || s.data.error }
    await logJob(sb, 'prefetch-daily:sf-modified', s.ok, s.ms, out.sfModified)
  } else {
    out.zohoDeals = { skipped: 'time budget' }
    out.sfModified = { skipped: 'time budget' }
  }

  // ── 3. backfill של ad_daily — צעד אחד (חודש לכל חשבון), עם מה שנשאר מהתקציב ─────────
  // 25s מרווח: כתיבת השורות של המשימה האחרונה (נקטעת רק המשיכה, לא ה-upsert) + job_log.
  const bfBudget = left() - 25000
  if (bfBudget > 40000) {
    const bf = await runDailySync(sb, { mode: 'backfill', budgetMs: bfBudget, job: 'prefetch-daily:backfill' })
    out.backfill = { ok: bf.body.ok, done: bf.body.done, jobs: bf.body.jobs, failed: bf.body.failed, deferred: bf.body.deferred, ms: bf.body.ms,
      errors: (bf.body.results || []).filter(r => !r.ok && !r.deferred).map(r => `${r.source}/${r.account} ${r.since}..${r.until}: ${r.error}`).slice(0, 5) }
  } else {
    out.backfill = { skipped: 'time budget' }
  }

  // ── 4. Zoho: צעד מילוי היסטורי של חודש אחד (מ-ZOHO_BACKFILL_SINCE ואילך), רק כשנשאר זמן ──
  // מצבו נשמר ב-job_log (החודש האחרון שמולא). בלי טריגר ידני.
  const floor = (process.env.ZOHO_BACKFILL_SINCE || '2026-01')
  const prevMonth = (ym) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7) }
  const nowIl = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(new Date())
  const last = (await lastRuns(sb, 'prefetch-daily:zoho-backfill', 1))[0]
  const target = last?.detail?.month ? prevMonth(last.detail.month) : prevMonth(prevMonth(prevMonth(nowIl)))
  if (target < floor || last?.detail?.done) {
    out.zohoBackfill = { done: true, floor }
  } else if (left() > INTERNAL_TIMEOUT_MS + 10000) {
    const r = await callInternal('/api/zoho/fetch', { month: target })
    out.zohoBackfill = { ok: r.ok, month: target, ms: r.ms, error: r.error, projects: (r.data.projects || []).map(p => ({ project: p.project, leads: p.leads, error: p.error })) }
    await logJob(sb, 'prefetch-daily:zoho-backfill', r.ok, r.ms, { month: target, done: prevMonth(target) < floor, projects: out.zohoBackfill.projects })
  } else {
    out.zohoBackfill = { skipped: 'time budget', next: target }
  }

  // heartbeat סופי + גיזום הלוג
  await beat()
  if (new Date().getUTCHours() === 3) await pruneJobLog(sb, 30)

  const ok = out.recent.ok !== false && out.backfill.ok !== false
  return Response.json({ ok, elapsedMs: Date.now() - startedAt, ...out })
}
