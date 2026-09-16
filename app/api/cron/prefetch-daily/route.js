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
 */
import { createClient } from '@supabase/supabase-js'
import { runDailySync } from '../../../../lib/ads/daily-sync.js'
import { pruneJobLog } from '../../../../lib/job-log.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

export async function GET(request) {
  const startedAt = Date.now()
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '').trim()
  if (!process.env.CRON_SECRET || bearer !== process.env.CRON_SECRET) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY   // בלי נפילה חזרה למפתח הציבורי: חסר = 500 מפורש
  if (!supabaseUrl || !supabaseKey) return Response.json({ ok: false, error: 'env missing' }, { status: 500 })
  const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  const out = {}
  // recent קודם (הנתונים הטריים חשובים יותר), ואז backfill עם מה שנשאר מהתקציב.
  const recent = await runDailySync(sb, { mode: 'recent', budgetMs: 150000, job: 'prefetch-daily:recent' })
  out.recent = { ok: recent.body.ok, jobs: recent.body.jobs, failed: recent.body.failed, deferred: recent.body.deferred, ms: recent.body.ms,
    errors: (recent.body.results || []).filter(r => !r.ok && !r.deferred).map(r => `${r.source}/${r.account}: ${r.error}`).slice(0, 5) }
  const left = 270000 - (Date.now() - startedAt)
  if (left > 40000) {
    const bf = await runDailySync(sb, { mode: 'backfill', budgetMs: left - 10000, job: 'prefetch-daily:backfill' })
    out.backfill = { ok: bf.body.ok, done: bf.body.done, jobs: bf.body.jobs, failed: bf.body.failed, deferred: bf.body.deferred, ms: bf.body.ms,
      errors: (bf.body.results || []).filter(r => !r.ok && !r.deferred).map(r => `${r.source}/${r.account} ${r.since}..${r.until}: ${r.error}`).slice(0, 5) }
  } else {
    out.backfill = { skipped: 'time budget' }
  }

  // heartbeat + גיזום הלוג
  try { await sb.from('cron_heartbeat').upsert({ job: 'prefetch-daily', last_run: new Date().toISOString() }, { onConflict: 'job' }) } catch {}
  if (new Date().getUTCHours() === 3) await pruneJobLog(sb, 30)

  const ok = out.recent.ok !== false && out.backfill.ok !== false
  return Response.json({ ok, elapsedMs: Date.now() - startedAt, ...out })
}
