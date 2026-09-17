/**
 * GET /api/v1/health
 *   Authorization: Bearer <MONITOR_TOKEN>
 *
 * פיד רעננות לקריאה בלבד, לסוכן הבדיקה היומי.
 *
 * הרקע: הסוכן בדק את הנתונים דרך /api/reports/by-project עם מפתח ה-anon בכותרת. המפתח
 * הזה הוא מפתח ה-anon — מוטמע בבאנדל, ציבורי, ולכן מעולם לא היה הרשאה — והוסר
 * בתיקון האבטחה של 9.2026. מאז הסוכן קיבל 401 ונפל לקריאה ישירה מ-Supabase.
 * ה-route הזה נותן לו דלת קדמית מסודרת.
 *
 * - טוקן Bearer מטבלת api_tokens, בהיקף client_slug = '*' (היקף ניטור). טוקן של
 *   לקוח בודד מקבל 403, כי הפיד מציג את כל הפרויקטים של כל הלקוחות.
 * - אגרגטים בלבד: שם פרויקט, סטטוס לכל בדיקה, דופק הקרונים. בלי PII ובלי מספרים
 *   עסקיים.
 * - אותם חיישנים בדיוק כמו במייל הבריאות השעתי (lib/health.js), כדי ששניהם
 *   יסכימו תמיד.
 */
import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { adminClient } from '../../../../lib/auth'
import { computeHealth } from '../../../../lib/health'
import { lastRuns } from '../../../../lib/job-log.js'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'
export const maxDuration = 60

const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store, max-age=0' } })
const hoursAgo = ts => ts ? Math.round((Date.now() - new Date(ts).getTime()) / 3.6e5) / 10 : null

export async function GET(request) {
  const proto = request.headers.get('x-forwarded-proto')
  if (proto && proto !== 'https') return J({ error: 'https_required' }, 400)

  const auth = request.headers.get('authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return J({ error: 'missing_bearer_token' }, 401)

  const sb = adminClient()
  const tokenHash = createHash('sha256').update(m[1].trim()).digest('hex')
  const { data: tok } = await sb
    .from('api_tokens').select('id, client_slug')
    .eq('token_hash', tokenHash).eq('revoked', false).maybeSingle()
  if (!tok) return J({ error: 'invalid_or_revoked_token' }, 401)
  if (tok.client_slug !== '*') return J({ error: 'monitor_scope_required', hint: "token must have client_slug = '*'" }, 403)
  sb.from('api_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', tok.id).then(() => {}, () => {})

  let health
  try {
    health = await computeHealth(sb)
  } catch (e) {
    return J({ error: 'health_failed', detail: String(e?.message || e) }, 500)
  }

  // דופק הקרונים — אותן שורות שה-watchdog השעתי קורא. בסביבה חדשה הטבלה עלולה
  // עוד לא להתקיים; אז מחזירים null ולא נופלים.
  let cronHeartbeats = null
  try {
    const { data, error } = await sb.from('cron_heartbeat').select('job, last_run')
    if (!error) cronHeartbeats = (data || []).map(b => ({ job: b.job, last_run: b.last_run, hours_ago: hoursAgo(b.last_run) }))
  } catch { /* bootstrap */ }

  // שלב 2/5 של docs/daily-ranges-plan.md — מצב העובדות היומיות ותמונת ה-CRM, אגרגטים בלבד.
  let dailyFacts = null
  try {
    const [cov, syncRecent, syncBackfill, adsBlock] = await Promise.all([
      sb.rpc('ad_daily_coverage'),
      lastRuns(sb, 'prefetch-daily:recent', 3),
      lastRuns(sb, 'prefetch-daily:backfill', 3),
      lastRuns(sb, 'prefetch-ads:daily-block', 3),
    ])
    dailyFacts = {
      coverage: (cov.data || []).map(c => ({ source: c.source, account: c.account, min_day: c.min_day, max_day: c.max_day, days: c.days, rows: c.rows, last_fetched: c.last_fetched })),
      last_runs: { 'prefetch-daily:recent': syncRecent, 'prefetch-daily:backfill': syncBackfill, 'prefetch-ads:daily-block': adsBlock },
    }
  } catch (e) { dailyFacts = { error: String(e?.message || e) } }
  let crmSnapshot = null
  try {
    const { data } = await sb.from('crm_raw').select('project_id, entity, fetched_at')
      .order('fetched_at', { ascending: false }).limit(1)
    const { count } = await sb.from('crm_raw').select('*', { count: 'exact', head: true })
    crmSnapshot = { rows: count ?? null, last_fetched: data?.[0]?.fetched_at || null }
  } catch (e) { crmSnapshot = { error: String(e?.message || e) } }

  return J({
    generated_at: new Date().toISOString(),
    timezone: 'Asia/Jerusalem',
    ok: !health.anyRed,
    reds: health.reds,
    issues: health.issues,
    projects: health.projects,
    cron_heartbeats: cronHeartbeats,
    daily_facts: dailyFacts,
    crm_snapshot: crmSnapshot,
    notes: 'Aggregates only, no PII. Same sensors as the hourly health email (lib/health.js). ' +
           'Crons run every 2h from ~07:00 Israel via cron-job.org; a gap overnight is normal.',
  })
}
